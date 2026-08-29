use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Duration;

const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

pub(super) struct UnixHttpClient;

impl UnixHttpClient {
    pub fn get(socket: &Path, token: &str, path: &str) -> Result<Vec<u8>, String> {
        let mut stream = UnixStream::connect(socket)
            .map_err(|error| format!("Could not reach Happy Agent: {error}"))?;
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .map_err(|error| error.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_secs(10)))
            .map_err(|error| error.to_string())?;
        let request = request_bytes(token, path);
        stream
            .write_all(&request)
            .map_err(|error| format!("Could not write Happy Agent request: {error}"))?;
        let mut response = Vec::new();
        stream
            .take((MAX_RESPONSE_BYTES + 1) as u64)
            .read_to_end(&mut response)
            .map_err(|error| format!("Could not read Happy Agent response: {error}"))?;
        if response.len() > MAX_RESPONSE_BYTES {
            return Err("Happy Agent returned an oversized response.".to_owned());
        }
        parse_response(&response)
    }
}

fn request_bytes(token: &str, path: &str) -> Vec<u8> {
    format!(
        "GET {path} HTTP/1.1\r\nHost: happy-agent\r\nAccept: application/json\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    )
    .into_bytes()
}

fn parse_response(response: &[u8]) -> Result<Vec<u8>, String> {
    let boundary = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "Happy Agent returned an invalid HTTP response.".to_owned())?;
    let head = std::str::from_utf8(&response[..boundary])
        .map_err(|_| "Happy Agent returned invalid HTTP headers.".to_owned())?;
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| "Happy Agent returned an invalid HTTP status.".to_owned())?;
    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_owned()))
        .collect::<Vec<_>>();
    let body = &response[boundary + 4..];
    let body = if headers
        .iter()
        .any(|(name, value)| name == "transfer-encoding" && value.eq_ignore_ascii_case("chunked"))
    {
        decode_chunked(body)?
    } else {
        body.to_vec()
    };
    if !(200..300).contains(&status) {
        let detail = serde_json::from_slice::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value.get("error")?.as_str().map(str::to_owned))
            .unwrap_or_else(|| format!("Happy Agent returned HTTP {status}."));
        return Err(detail);
    }
    Ok(body)
}

fn decode_chunked(mut input: &[u8]) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    loop {
        let line_end = input
            .windows(2)
            .position(|window| window == b"\r\n")
            .ok_or_else(|| "Happy Agent returned invalid chunked data.".to_owned())?;
        let size_text = std::str::from_utf8(&input[..line_end])
            .map_err(|_| "Happy Agent returned an invalid chunk size.".to_owned())?;
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or_default(), 16)
            .map_err(|_| "Happy Agent returned an invalid chunk size.".to_owned())?;
        input = &input[line_end + 2..];
        if size == 0 {
            return Ok(output);
        }
        if input.len() < size + 2 || &input[size..size + 2] != b"\r\n" {
            return Err("Happy Agent returned a truncated chunk.".to_owned());
        }
        output.extend_from_slice(&input[..size]);
        input = &input[size + 2..];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_content_length_and_chunked_json_without_exposing_headers() {
        assert_eq!(
            parse_response(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}").unwrap(),
            b"{}"
        );
        assert_eq!(
            parse_response(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\n{\"a\"\r\n3\r\n:1}\r\n0\r\n\r\n"
            )
            .unwrap(),
            b"{\"a\":1}"
        );
    }

    #[test]
    fn preserves_displayable_daemon_errors() {
        let error = parse_response(
            b"HTTP/1.1 409 Conflict\r\nContent-Length: 24\r\n\r\n{\"error\":\"still busy\"}",
        )
        .unwrap_err();
        assert_eq!(error, "still busy");
    }

    #[test]
    fn request_injects_host_authority_without_putting_it_in_the_route() {
        let request = String::from_utf8(request_bytes("host-secret", "/v0/health")).unwrap();
        assert!(request.starts_with("GET /v0/health HTTP/1.1\r\n"));
        assert!(request.contains("Authorization: Bearer host-secret\r\n"));
        assert!(!request.starts_with("GET host-secret"));
    }
}
