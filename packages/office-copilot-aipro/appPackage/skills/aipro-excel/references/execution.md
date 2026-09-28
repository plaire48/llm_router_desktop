# Execution availability

This plugin is intended for native Copilot in Excel. Excel custom skills are preview functionality; availability depends on Office build/channel and tenant settings. A plugin being visible in M365 Copilot Chat or Cowork does not establish Excel workbook access.

Use the runtime's existing Excel read/edit tools. This skill does not assume a parameterized Office.js script runtime; the current Microsoft example does not support arguments for Office.js skill functions.

Outside Excel, or when read/edit tools are unavailable, explain that the open workbook cannot be changed in this context. AI Pro analysis of explicitly provided cells can still be reported as analysis, with no workbook-change claim.

The remote MCP server authenticates the configured Microsoft user before calling a separately provisioned AI Pro account. An authentication error requires fixing the connector connection, not requesting secrets in the conversation. The pilot is limited to one configured Entra user and AI Pro account per server instance.
