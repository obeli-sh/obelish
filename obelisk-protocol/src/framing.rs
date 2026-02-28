use std::io;
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::rpc::{RpcRequest, RpcResponse};

const MAX_MESSAGE_SIZE: u32 = 1_048_576; // 1MB

#[derive(Debug, Error)]
pub enum FramingError {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("message too large: {size} bytes (max {MAX_MESSAGE_SIZE})")]
    Oversized { size: u32 },
    #[error("invalid JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("unexpected end of stream")]
    UnexpectedEof,
}

/// Server-side: read a request from the client.
pub async fn read_message<R: AsyncRead + Unpin>(
    reader: &mut R,
) -> Result<RpcRequest, FramingError> {
    let len = read_length(reader).await?;
    let bytes = read_bytes(reader, len).await?;
    serde_json::from_slice(&bytes).map_err(FramingError::InvalidJson)
}

/// Server-side: write a response to the client.
pub async fn write_message<W: AsyncWrite + Unpin>(
    writer: &mut W,
    response: &RpcResponse,
) -> Result<(), FramingError> {
    let bytes = serde_json::to_vec(response)?;
    write_frame(writer, &bytes).await
}

/// Client-side: write a request to the server.
pub async fn write_request<W: AsyncWrite + Unpin>(
    writer: &mut W,
    request: &RpcRequest,
) -> Result<(), FramingError> {
    let bytes = serde_json::to_vec(request)?;
    write_frame(writer, &bytes).await
}

/// Client-side: read a response from the server.
pub async fn read_response<R: AsyncRead + Unpin>(
    reader: &mut R,
) -> Result<RpcResponse, FramingError> {
    let len = read_length(reader).await?;
    let bytes = read_bytes(reader, len).await?;
    serde_json::from_slice(&bytes).map_err(FramingError::InvalidJson)
}

async fn read_length<R: AsyncRead + Unpin>(reader: &mut R) -> Result<u32, FramingError> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => {
            return Err(FramingError::UnexpectedEof)
        }
        Err(e) => return Err(FramingError::Io(e)),
    }
    let len = u32::from_be_bytes(len_buf);
    if len > MAX_MESSAGE_SIZE {
        return Err(FramingError::Oversized { size: len });
    }
    Ok(len)
}

async fn read_bytes<R: AsyncRead + Unpin>(
    reader: &mut R,
    len: u32,
) -> Result<Vec<u8>, FramingError> {
    let mut buf = vec![0u8; len as usize];
    match reader.read_exact(&mut buf).await {
        Ok(_) => Ok(buf),
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => Err(FramingError::UnexpectedEof),
        Err(e) => Err(FramingError::Io(e)),
    }
}

async fn write_frame<W: AsyncWrite + Unpin>(
    writer: &mut W,
    bytes: &[u8],
) -> Result<(), FramingError> {
    let len = bytes.len() as u32;
    writer.write_all(&len.to_be_bytes()).await?;
    writer.write_all(bytes).await?;
    writer.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Cursor;

    fn sample_request() -> RpcRequest {
        RpcRequest {
            jsonrpc: "2.0".to_string(),
            method: "workspace.create".to_string(),
            params: Some(json!({"name": "test"})),
            id: json!(1),
        }
    }

    fn sample_response() -> RpcResponse {
        RpcResponse::success(json!(1), json!({"status": "ok"}))
    }

    #[tokio::test]
    async fn read_valid_message() {
        let req = sample_request();
        let json_bytes = serde_json::to_vec(&req).unwrap();
        let len = (json_bytes.len() as u32).to_be_bytes();

        let mut data = Vec::new();
        data.extend_from_slice(&len);
        data.extend_from_slice(&json_bytes);

        let mut cursor = Cursor::new(data);
        let result = read_message(&mut cursor).await.unwrap();
        assert_eq!(result, req);
    }

    #[tokio::test]
    async fn write_produces_correct_format() {
        let resp = sample_response();
        let mut buf = Vec::new();
        let mut cursor = Cursor::new(&mut buf);
        write_message(&mut cursor, &resp).await.unwrap();

        let written = cursor.into_inner();
        assert!(written.len() > 4);

        // First 4 bytes are the big-endian length
        let len = u32::from_be_bytes([written[0], written[1], written[2], written[3]]);
        assert_eq!(len as usize, written.len() - 4);

        // Remaining bytes are valid JSON matching the response
        let json_bytes = &written[4..];
        let parsed: RpcResponse = serde_json::from_slice(json_bytes).unwrap();
        assert_eq!(parsed, resp);
    }

    #[tokio::test]
    async fn roundtrip_request() {
        let req = sample_request();
        let mut buf = Vec::new();

        // Write request
        let mut write_cursor = Cursor::new(&mut buf);
        write_request(&mut write_cursor, &req).await.unwrap();

        // Read it back
        let mut read_cursor = Cursor::new(write_cursor.into_inner().as_slice());
        let result = read_message(&mut read_cursor).await.unwrap();
        assert_eq!(result, req);
    }

    #[tokio::test]
    async fn roundtrip_response() {
        let resp = sample_response();
        let mut buf = Vec::new();

        // Write response
        let mut write_cursor = Cursor::new(&mut buf);
        write_message(&mut write_cursor, &resp).await.unwrap();

        // Read it back
        let mut read_cursor = Cursor::new(write_cursor.into_inner().as_slice());
        let result = read_response(&mut read_cursor).await.unwrap();
        assert_eq!(result, resp);
    }

    #[tokio::test]
    async fn truncated_length_prefix() {
        // Only 2 bytes instead of 4
        let data = [0u8, 5];
        let mut cursor = Cursor::new(&data[..]);
        let result = read_message(&mut cursor).await;
        assert!(matches!(result, Err(FramingError::UnexpectedEof)));
    }

    #[tokio::test]
    async fn truncated_body() {
        // Length says 100 bytes but body is only 5
        let len_bytes = 100u32.to_be_bytes();
        let mut data = Vec::new();
        data.extend_from_slice(&len_bytes);
        data.extend_from_slice(b"short");

        let mut cursor = Cursor::new(data.as_slice());
        let result = read_message(&mut cursor).await;
        assert!(matches!(result, Err(FramingError::UnexpectedEof)));
    }

    #[tokio::test]
    async fn oversized_rejected() {
        // 2MB length header (exceeds 1MB limit)
        let len_bytes = (2 * 1024 * 1024u32).to_be_bytes();
        let mut cursor = Cursor::new(&len_bytes[..]);
        let result = read_message(&mut cursor).await;
        assert!(matches!(result, Err(FramingError::Oversized { size }) if size == 2 * 1024 * 1024));
    }

    #[tokio::test]
    async fn invalid_json() {
        let garbage = b"this is not json";
        let len_bytes = (garbage.len() as u32).to_be_bytes();

        let mut data = Vec::new();
        data.extend_from_slice(&len_bytes);
        data.extend_from_slice(garbage);

        let mut cursor = Cursor::new(data.as_slice());
        let result = read_message(&mut cursor).await;
        assert!(matches!(result, Err(FramingError::InvalidJson(_))));
    }

    #[tokio::test]
    async fn empty_stream() {
        let data: &[u8] = &[];
        let mut cursor = Cursor::new(data);
        let result = read_message(&mut cursor).await;
        assert!(matches!(result, Err(FramingError::UnexpectedEof)));
    }
}
