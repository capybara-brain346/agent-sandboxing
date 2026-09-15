import json
import os
import tempfile
import uuid
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class TerminalBenchAgent(BaseInstalledAgent):
    @staticmethod
    def name() -> str:
        return "agent-sandboxing"

    async def install(self, environment: BaseEnvironment) -> None:
        entrypoint = Path(os.environ.get("TERMINAL_BENCH_ENTRYPOINT", ""))
        profile = Path("src/services/agent/tools/profiles/profiles.yaml")
        prompts = Path("prompts")
        if not entrypoint.is_file():
            raise RuntimeError("TERMINAL_BENCH_ENTRYPOINT must name the bundled runner")
        if not profile.is_file() or not (prompts / "session-agent.yaml").is_file() or not (prompts / "subagent.yaml").is_file():
            raise RuntimeError("agent prompts and tool profile are required")
        await self.exec_as_root(
            environment,
            command="command -v node || (command -v apt-get && apt-get update && apt-get install -y nodejs) || (command -v apk && apk add --no-cache nodejs)",
        )
        await self.exec_as_root(environment, command="mkdir -p /installed-agent/prompts")
        await environment.upload_file(entrypoint, "/installed-agent/agent-runner.mjs")
        await environment.upload_file(profile, "/installed-agent/profiles.yaml")
        await environment.upload_file(prompts / "session-agent.yaml", "/installed-agent/prompts/session-agent.yaml")
        await environment.upload_file(prompts / "subagent.yaml", "/installed-agent/prompts/subagent.yaml")
        await self.exec_as_root(
            environment,
            command="chmod 755 /installed-agent/agent-runner.mjs",
        )

    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        key = os.environ.get("OPENROUTER_API_KEY")
        if not key:
            raise RuntimeError("OPENROUTER_API_KEY is required")
        remote_instruction = f"/tmp/terminal-bench-instruction-{uuid.uuid4()}.txt"
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8") as file:
            file.write(instruction)
            file.flush()
            await environment.upload_file(file.name, remote_instruction)
        result = await self.exec_as_agent(
            environment,
            command=f"node /installed-agent/agent-runner.mjs {remote_instruction}",
            env={
                "OPENROUTER_API_KEY": key,
                "AGENT_MODEL": os.environ.get(
                    "AGENT_MODEL", "openrouter:deepseek/deepseek-v4-flash"
                ),
                "DATABASE_URL": "postgresql://terminal-bench:terminal-bench@localhost/terminal-bench",
                "AGENT_MAX_STEPS": os.environ.get("AGENT_MAX_STEPS", "25"),
                "AGENT_TOOL_PROFILES_PATH": "/installed-agent/profiles.yaml",
                "AGENT_PROMPTS_PATH": "/installed-agent/prompts",
                "AGENT_TOOL_TIMEOUT_MS": os.environ.get(
                    "AGENT_TOOL_TIMEOUT_MS", "30000"
                ),
            },
        )
        output = result.stdout.strip().splitlines()[-1:]
        if output:
            try:
                json.loads(output[0])
            except json.JSONDecodeError:
                output = [json.dumps({"status": "failed", "error": "invalid agent result"})]
            (self.logs_dir / "terminal-bench-agent-result.json").write_text(
                output[0] + "\n", encoding="utf-8"
            )

    def populate_context_post_run(self, context: AgentContext) -> None:
        return None
