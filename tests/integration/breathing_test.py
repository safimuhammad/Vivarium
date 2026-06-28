from email import message
from ollama import chat
from ollama import ChatResponse
import asyncio
from rich.console import Console, Group
from rich.panel import Panel
from rich.text import Text
from rich.syntax import Syntax
from rich.rule import Rule
from rich.box import ROUNDED
from rich.live import Live

import pytest

# Live-Ollama prototype: excluded from the default/CI run. The heavy work runs
# only under the ``__main__`` guard, so pytest can collect this module without a
# running Ollama instance.
pytestmark = pytest.mark.integration

console = Console()


class Agent:
    PAUSE: int = 1

    def __init__(self, model: str = "dolphin3") -> None:
        self.chat_history = []
        self.model = model
        self.load_system_prompt
        self.MOCK_WORLD = {
            "current_location": "forest_clearing",
            "locations": {
                "forest_clearing": {
                    "description": "A peaceful clearing surrounded by tall trees.",
                    "connections": ["north_path", "stream"],
                    "objects": ["old_stump", "wildflowers"],
                },
                "north_path": {
                    "description": "A winding dirt path heading into darker woods.",
                    "connections": ["forest_clearing", "cave_entrance"],
                    "objects": ["fallen_branch", "strange_markings"],
                },
                "stream": {
                    "description": "A gentle stream with clear water.",
                    "connections": ["forest_clearing"],
                    "objects": ["smooth_stones", "small_fish"],
                },
                "cave_entrance": {
                    "description": "A dark cave mouth. You hear dripping water inside.",
                    "connections": ["north_path"],
                    "objects": ["torch_sconce", "warning_sign"],
                },
            },
        }

    @property
    def load_system_prompt(self):
        sys_prompt = """
        You are Wanderer, a curious explorer who has just awakened in an unfamiliar world.

        Your traits:
        - Curious: You like to explore and understand your surroundings
        - Cautious: You think before acting in dangerous situations
        - Observant: You notice details others might miss

        You don't know why you're here or what your purpose is. You must discover it yourself.
        Available tools:
        - look_around(): Observe your surroundings.
        - move(destination): Move to a different location.
        - speak(message): Say something out loud.
        - wait(): Do nothing this turn and observe.
        """
        self.chat_history.append({"role": "system", "content": sys_prompt})

    async def generate_response(self):
        try:
            full_response = ""
            thinking = ""
            tool_calls = []
            in_thinking = False
            stream = chat(
                model=self.model,
                messages=self.chat_history,
                tools=self.load_tools,
                think=True,
                stream=True,
            )

            with Live(console=console, refresh_per_second=10) as live:
                for chunk in stream:
                    if chunk.message.thinking and not in_thinking:
                        in_thinking = True
                    if think := chunk.message.thinking:
                        thinking += think
                        live.update(self.render_thinking(thinking))
                    if tool := chunk.message.tool_calls:
                        tool_calls.extend(tool)

                    if part := chunk.message.content:
                        if in_thinking:
                            in_thinking = False
                        full_response += part
                        live.update(
                            Group(
                                self.render_thinking(thinking) if thinking else Text(""),
                                self.render_answer(full_response),
                            )
                        )
            return (full_response, thinking, tool_calls)

        except Exception as e:
            print(f"error in generating response {e}")

    def render_thinking(self, thought: str) -> Panel:
        body = Text(thought)
        body.stylize("dim italic")
        return Panel(
            body,
            title="THINKING",
            title_align="left",
            border_style="grey50",
            box=ROUNDED,
            padding=(1, 2),
        )

    def render_answer(self, answer: str) -> Panel:
        body = Text.from_markup(answer)
        return Panel(
            body,
            title="ANSWER",
            title_align="left",
            border_style="cyan",
            box=ROUNDED,
            padding=(1, 2),
        )

    def render_tool_output(self, output: str, lang: str = "json") -> Panel:
        syntax = Syntax(output, lang, theme="monokai", word_wrap=True)
        return Panel(
            syntax,
            title="TOOL",
            title_align="left",
            border_style="magenta",
            box=ROUNDED,
            padding=(1, 2),
        )

    @property
    def load_tools(self):
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "look_around",
                    "description": "Observe your surroundings",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "move",
                    "description": "Move to a different location",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "destination": {
                                "type": "string",
                                "description": "Where to move",
                            }
                        },
                        "required": ["destination"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "speak",
                    "description": "Say something out loud - so the others can hear you as well",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "message": {
                                "type": "string",
                                "description": "What to say",
                            }
                        },
                        "required": ["message"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "wait",
                    "description": "Do nothing this turn, just observe",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                    },
                },
            },
        ]

        return tools

    def tool_response(self, tool_name, params):
        console.print(
            self.render_tool_output(
                f"<Tool_executed>\nName: {tool_name}\nParams: {params}\n</Tool_executed>",
                lang="xml",
            )
        )
        if tool_name == "look_around":
            return self.mock_look_around()
        elif tool_name == "move":
            return self.mock_move(params.get("destination", ""))
        elif tool_name == "speak":
            return (
                f"You say: '{params.get('message', '')}'. Your voice echoes slightly."
            )
        elif tool_name == "think":
            return f"You contemplate: {params.get('thought', '')}"
        elif tool_name == "wait":
            return "You wait and observe. Nothing eventful happens."
        else:
            return "Unknown action."

    def mock_look_around(self):
        loc = self.MOCK_WORLD["current_location"]
        data = self.MOCK_WORLD["locations"][loc]

        return f"""
        Location: {loc}
        {data['description']}
        You can go to: {', '.join(data['connections'])}
        You see: {', '.join(data['objects'])}
        """

    def mock_move(self, destination):
        current = self.MOCK_WORLD["current_location"]
        if destination in self.MOCK_WORLD["locations"][current]["connections"]:
            self.MOCK_WORLD["current_location"] = destination
            return f"You travel to {destination}."
        else:
            return f"You can't reach {destination} from here."

    async def breathing_loop(self):
        breath_count: int = 0
        while True:
            if breath_count == 50:
                print(f"Test passed for max breath counts {breath_count}")
                break
            print(f"\nCurrent Breath Count {breath_count} out of 50\n")
            response, thinking, tool_calls = await self.generate_response()
            self.chat_history.append(
                {
                    "role": "assistant",
                    "thinking": thinking,
                    "content": response,
                    "tool_calls": tool_calls,
                }
            )
            if len(tool_calls) > 0:
                for tool in tool_calls:
                    tool_output = self.tool_response(
                        tool.function.name, tool.function.arguments
                    )
                    self.chat_history.append(
                        {
                            "role": "tool",
                            "tool_name": tool.function.name,
                            "content": str(tool_output),
                        }
                    )

            breath_count += 1
            await asyncio.sleep(self.PAUSE)


if __name__ == "__main__":
    agent = Agent(model="qwen3:8b")
    asyncio.run(agent.breathing_loop())
