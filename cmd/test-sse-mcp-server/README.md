# SSE MCP Test Server

A test server for verifying the external MCP feature in SSE mode.

## Usage

### 1. Start the test server

```bash
cd cmd/test-sse-mcp-server
go run main.go
```

The server starts at `http://127.0.0.1:8082` and provides these endpoints:
- `GET /sse` - SSE event stream endpoint
- `POST /message` - Message receiving endpoint

### 2. Add the configuration in CyberStrikeAI

In the web UI, add an external MCP configuration using the following JSON:

```json
{
  "test-sse-mcp": {
    "transport": "sse",
    "url": "http://127.0.0.1:8082/sse",
    "description": "SSE MCP test server",
    "timeout": 30
  }
}
```

### 3. Test features

The test server provides two test tools:

1. **test_echo** - echoes the input text
   - Parameter: `text` (string) - the text to echo

2. **test_add** - adds two numbers
   - Parameter: `a` (number) - the first number
   - Parameter: `b` (number) - the second number

## How it works

1. The client opens an SSE connection with `GET /sse` and receives events pushed by the server
2. The client sends MCP protocol messages with `POST /message`
3. After processing a message, the server pushes the response over the SSE connection

## Logs

The server prints the following logs:
- SSE client connect/disconnect
- Received requests (method name and ID)
- Tool call details

