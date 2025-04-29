# MCP Port Cleaner Server

Node.js server implementing Model Context Protocol (MCP) for port cleanup operations in development environments.

## Features

- Finds and terminates processes occupying specified ports
- Safe input parameter validation using Zod schema
- Detailed error handling and response formatting
- Standard MCP protocol compliance for tool registration and request processing

## Tools

### port_cleaner

**Description**: Finds and terminates processes occupying a specified port to resolve development environment port conflicts.

**Input Parameters**:

```json
{
  "port": {
    "type": "integer",
    "description": "Port number to clean",
    "minimum": 1,
    "maximum": 65535
  }
}
```

**Response**:
- Success: Returns list of terminated process IDs
- Failure: Returns error information
- Port not occupied: Returns appropriate notification

## Usage Examples

### With Claude Desktop

#### Docker Configuration

TODO

#### NPX Configuration

```json
{
  "mcpServers": {
    "port-cleaner": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-server-port-cleaner"
      ]
    }
  }
}
```

or install globally:

```bash
npm install -g mcp-server-port-cleaner
```

and then:

```json
{
  "mcpServers": {
    "port-cleaner": {
      "command": "mcp-server-port-cleaner"
    }
  }
}

## Implementation Details

The server implements the following components:

1. **PortCleanerService**: Core business logic for port cleanup operations
2. **MCP Server Integration**: Standard MCP protocol implementation with:
   - Tool registration (`port_cleaner`)
   - Request handling
   - Input validation
3. **Error Handling**: Comprehensive error handling at both service and server levels

## Error Handling

The server provides detailed error responses in all failure scenarios:
- Invalid input parameters
- Process termination failures
- Unexpected runtime errors

## Development Notes

- The service uses `lsof` and `kill` commands which are Linux/Unix specific
- For Windows compatibility, alternative port management commands would be needed
- The current implementation terminates processes with SIGKILL (-9)

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.