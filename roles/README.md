# Role Configuration Files

This directory contains all role configuration files. Each role defines the AI's behavior pattern and the tools available to it.

## Creating a New Role

To create a new role, add a YAML file under the `roles/` directory in the following format:

**Option 1: Specify the tool list explicitly (recommended)**
```yaml
name: Role name
description: Role description
user_prompt: User prompt (prepended to the user message to guide the AI's behavior)
icon: "Icon (optional)"
tools:
    # Add the tools you need...
    # ⚠️ Important: include the following core built-in MCP tools (vulnerability and knowledge base)
    - record_vulnerability
    - list_knowledge_risk_types
    - search_knowledge_base
enabled: true
```

**Option 2: Omit the tools field (use all enabled tools)**
```yaml
name: Role name
description: Role description
user_prompt: User prompt (prepended to the user message to guide the AI's behavior)
icon: "Icon (optional)"
# Without a tools field, all tools enabled in MCP management are used by default
enabled: true
```

## ⚠️ Important: Core Built-in MCP Tools

**If you set the `tools` field, make sure the list includes the following tools (at least these three):**

1. **`record_vulnerability`** - Vulnerability management tool, used to record discovered vulnerabilities
2. **`list_knowledge_risk_types`** - Knowledge base tool, lists the available risk types
3. **`search_knowledge_base`** - Knowledge base tool, searches the knowledge base content

You can also add other built-in or external tools, such as WebShell and batch task tools, as needed (whatever is enabled in MCP management applies).

**Skills (skill packages)**: In **Pi single-agent or multi-agent** sessions, the built-in **`skill`** tool loads packages from `skills_dir` on demand. Skills are not bound to the role YAML.

**Note**: If you omit the `tools` field, the system uses all tools enabled in MCP management by default. To control explicitly which tools a role can use, set the `tools` field.

## Role Configuration Fields

- **name**: Role name (required)
- **description**: Role description (required)
- **user_prompt**: User prompt, prepended to the user message to guide the AI toward specific testing methods and focus areas (optional)
- **icon**: Role icon, supports Unicode emoji (optional)
- **tools**: Tool list that specifies which tools the role can use (optional)
  - **If the `tools` field is omitted**: **all tools enabled in MCP management** are selected by default
  - **If the `tools` field is set**: only the tools listed are used (include at least the core built-in tools above)
- **enabled**: Whether the role is enabled (required, true/false)

## Examples

See the other role files in this directory, such as `penetration-testing.yaml` and `web-application-scanning.yaml`.
