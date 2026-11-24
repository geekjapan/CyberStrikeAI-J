# Chat

Chat is the main surface: the user types a request, the agent runs with the selected role and model, and the reply and its tool calls stream into the conversation. The conversation is saved and listed on the left.

## Sub-features

- `chat-send`: the typed message appears as the user's bubble.
- `chat-stored`: a conversation titled with the message is returned by `GET /api/conversations`.
- `chat-reply`: the assistant bubble finishes without an error.

## How to get to it (user POV)

- Navigation: `Chat`. Type into the message box at the bottom and click `Send`.
- `New chat` (top of the conversation list) starts another conversation.

## Driving it with drive.mjs

Preconditions:

- Baseline, and the instance was launched with a reachable OpenAI-compatible model:
  `VERIFY_AI_BASE_URL=<url ending in /v1> VERIFY_AI_API_KEY=<key> VERIFY_AI_MODEL=<model> .claude/skills/verify-cyberstrikeai/launch.sh`.
  Pass the key through the environment; do not write it into a file in the repository.

- **Run.** `node .claude/skills/verify-cyberstrikeai/drive.mjs .claude/skills/verify-cyberstrikeai/journeys/chat.mjs`.
- **Send.** It goes to `#/chat`, fills the textbox named `Message` with `Reply with the single word pong. (<timestamp>)` and clicks `Send`. The first `.chat-bubble` contains the text, and `writes` has `200 POST /api/agent/stream`. Screenshot `01-sent.png`.
- **Stored.** It reads `GET /api/conversations` and fails if no conversation title starts with the message.
- **Reply.** It waits for the `POST /api/agent/stream` response to finish (the server closes the event stream when the run ends), then fails if `.chat-live-error` is present or the second `.chat-bubble` contains `❌`. Screenshot `02-reply.png`. `observed.reply` holds the end of the reply.

## Gotchas

- **Without a model this journey fails at `chat-reply`, and that is the correct result.** The default launch points the model at `http://127.0.0.1:9/v1`; the assistant bubble then shows `❌` and an `Execution failed: …` line in the UI language. `chat-send` and `chat-stored` still held in that run (see the screenshots), but do not report chat as verified.
- **The reply step has never passed in this skill's own proof run**, because no model was available. The first run with a real model also verifies the `VERIFY_AI_*` settings; if it fails, check `ai.channels.qwen-max` in `.run/instance/config.yaml` first.
- `config.example.yaml` points at a public model gateway with a placeholder key. `launch.sh` replaces that address so a chat test never sends prompts off this machine unless `VERIFY_AI_BASE_URL` says so.
- With a model, the agent may call tools, which run as local processes with your permissions. Keep the prompt free of targets and commands.
- Do not wait on status wording (`Generating`): it is translated and changes with the UI language. An earlier version of this journey did and passed falsely after the strings were translated. Wait on the stream response instead.
- Progress and error text streamed by the server (`Execution failed: …`) is English in the source and translated to the UI language, live and in reloaded history. Assert on the `❌` marker and `.chat-live-error`, or on the en-US text.
- Roles, multi-agent mode, attachments, human-in-the-loop approval and stopping a run are not mapped.
