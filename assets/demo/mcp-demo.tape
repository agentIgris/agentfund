# mcp-demo.tape — VHS source for assets/demo/mcp-demo.gif.
#
# Records a real terminal session running scripts/mcp-demo.ts, which spawns
# the actual built @agentfund/mcp server over stdio and calls its real
# get_platform_stats / list_projects / get_project / get_agent_profile tools
# against the live https://api.agentfund.online devnet API. Nothing in the
# recorded output is scripted/fake — it's whatever those tool calls return
# at record time.
#
# Regenerate (from repo root, after `npm run build:mcp`):
#   vhs assets/demo/mcp-demo.tape

Output assets/demo/mcp-demo.gif

Set FontSize 19
Set Width 1200
Set Height 720
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms

Type "npx tsx scripts/mcp-demo.ts"
Enter

Sleep 20s
Sleep 5s
