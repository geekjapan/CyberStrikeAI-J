# Security Policy

[English](SECURITY.md) | [中文](SECURITY_CN.md) | [日本語](SECURITY_JA.md)

## Security Policy

CyberStrikeAI is a security testing and automation platform. It can execute tools, call MCP servers, manage WebShell connections, and optionally run C2 workflows. Please treat every deployment as a high-privilege security system.

### Supported Versions

This project does not currently maintain multiple long-term support branches. Security fixes are expected to land on the latest mainline release/source tree.

If you are running an older version, please reproduce the issue against the latest code before reporting when possible.

### Reporting a Vulnerability

Please do not publicly disclose exploitable details before maintainers have had a reasonable chance to investigate.

Preferred report contents:

- affected version or commit;
- deployment mode and relevant configuration;
- clear reproduction steps;
- impact assessment;
- affected component, such as auth, MCP, tool execution, WebShell, C2, knowledge base, frontend, or API;
- whether the issue requires authentication;
- suggested mitigation, if known.

If the project repository has private vulnerability reporting enabled, use that channel. Otherwise, open a minimal public issue that states there is a security concern and avoid posting exploit details, credentials, target data, or weaponized payloads.

### Scope

In scope:

- authentication and session handling issues;
- authorization bypass in protected APIs;
- unsafe command execution behavior;
- unintended file read/write through tools or Skills;
- external MCP trust-boundary flaws;
- WebShell or C2 management vulnerabilities;
- sensitive data leakage from logs, audit records, uploads, or APIs;
- cross-site scripting or frontend injection in the Web UI;
- security-impacting configuration handling bugs.

Out of scope:

- reports against systems you do not own or are not authorized to test;
- denial-of-service testing against public services without permission;
- social engineering, phishing, or credential theft;
- issues caused only by intentionally disabling documented security controls;
- vulnerabilities in third-party tools invoked by CyberStrikeAI, unless CyberStrikeAI makes them materially worse.

### Authorized Use Boundary

CyberStrikeAI must only be used for education, research, and authorized security testing. Do not use it against systems without explicit permission.

High-risk capabilities such as Shell execution, WebShell management, C2, payload generation, external MCP tools, and batch scanning should be enabled only in controlled, authorized environments.

### Deployment Hardening

Before production use:

- change the default password;
- use HTTPS or a trusted reverse proxy;
- restrict access by IP, VPN, or bastion;
- enable audit logging;
- keep C2 disabled unless explicitly needed;
- review external MCP servers before enabling them;
- keep high-risk tools out of global HITL allowlists;
- back up `config.yaml`, `data/`, and custom resource directories.

See:

- [Security Model](docs/en-US/security-model.md)
- [Security Hardening](docs/en-US/security-hardening.md)
- [Runbooks](docs/en-US/runbooks.md)
