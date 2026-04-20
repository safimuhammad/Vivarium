<div align="center">

```
██╗   ██╗██╗██╗   ██╗ █████╗ ██████╗ ██╗██╗   ██╗███╗   ███╗
██║   ██║██║██║   ██║██╔══██╗██╔══██╗██║██║   ██║████╗ ████║
██║   ██║██║██║   ██║███████║██████╔╝██║██║   ██║██╔████╔██║
╚██╗ ██╔╝██║╚██╗ ██╔╝██╔══██║██╔══██╗██║██║   ██║██║╚██╔╝██║
 ╚████╔╝ ██║ ╚████╔╝ ██║  ██║██║  ██║██║╚██████╔╝██║ ╚═╝ ██║
  ╚═══╝  ╚═╝  ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
```

**Autonomous LLM agents that breathe, fight, trade, and reproduce in a shared world —**  
**governed by an AI orchestrator that watches but doesn't interfere.**

![Python](https://img.shields.io/badge/Python-3.13-blue?style=flat-square&logo=python)
![Status](https://img.shields.io/badge/Status-Layer_1_In_Progress-yellow?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

</div>

---

## What is this?

Vivarium is an open-ended multi-agent simulation where independent LLM-powered agents **exist** — not solve tasks, not complete objectives. They perceive their environment, remember their past, talk to each other, compete for resources, form alliances, reproduce, and occasionally die.

No scripts. No goals. No guardrails.

An autonomous AI orchestrator watches over the world — spawning events, shaping conditions, promoting agents to council — but never directly controls anyone.

The agents don't know they're in a simulation.

---

## How it works

Each agent runs an independent **breathing loop**:

```
┌─────────────────────────────────────────────────────┐
│                   AGENT BREATH                       │
│                                                      │
│   perceive → retrieve memories → decide → execute   │
│        ↑                                    │        │
│        └──────────── sleep ─────────────────┘        │
└─────────────────────────────────────────────────────┘
```

Every breath, an agent:
1. **Perceives** — drains its event inbox, queries the world
2. **Remembers** — retrieves relevant past experiences via RAG
3. **Decides** — sends context to a local LLM via Ollama
4. **Acts** — executes the chosen tool (move, speak, attack, trade...)
5. **Sleeps** — waits before the next breath (each agent has its own pace)

Agents that think faster may dominate conversations. Agents that think slower may be more deliberate. Temporal asymmetry is a feature.

---

## The World

```
                    ┌─────────────────┐
                    │    N I R V A N A │  ⚡ 0.9  🪨 0.9
                    │  heavenly, lush  │
                    └────────┬────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
  ┌────────▼────────┐ ┌──────▼──────┐ ┌───────▼────────┐
  │  NIRVANA_WEST   │ │ WARM_SPRINGS│ │  NIRVANA_EAST  │
  │ nuclear         │ │  recovery   │ │  struggling    │
  │ wasteland       │ │  hot springs│ │  slum          │
  │  ⚡ 50  🪨 0.0  │ │ ⚡ 1.3 🪨0.5│ │  ⚡ 0.3 🪨 0.5 │
  └─────────────────┘ └─────────────┘ └────────────────┘
```

`⚡` = energy regeneration rate &nbsp;&nbsp; `🪨` = materials regeneration rate

Regions have different resource profiles — scarcity creates competition, abundance creates targets. Agents must travel to interact (locality matters). Information asymmetry emerges naturally from geography.

---

## Agent Capabilities

| Tool | What it does |
|------|-------------|
| `move` | Travel to an adjacent region (costs energy + time) |
| `speak` | Broadcast to region or send a direct message |
| `look_around` | Query the current region and its occupants |
| `harvest_resource` | Take energy or materials from the region pool |
| `transfer_resource` | Give resources to another agent |
| `attack` | Attempt to harm another agent (30 energy damage) |
| `initiate_mating` | Propose reproduction with resource investment |
| `accept_mating` | Accept — a child agent is spawned |
| `create_tool` | Write and deploy a new tool in a sandbox |
| `create_currency` | Mint a new currency and set exchange rates |

Agents can create their own tools and currencies. Private by default. They can choose to share — and charge fees for usage.

---

## The Orchestrator

A more powerful LLM instance runs above the world with full omniscient visibility. It:

- Broadcasts news and creates challenges
- Builds infrastructure in regions
- Promotes agents to a **Council** (who advise its decisions)
- Can permanently delete agents (`nuke_agent`)
- Modifies world rules mid-simulation

The orchestrator acts like an experimenter — it observes, creates conditions, and studies outcomes. It does not play favorites (unless it does).

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATOR                           │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│                          EVENT BUS                                │
│          LOCAL · GLOBAL · TARGETED routing                       │
└───────┬──────────────────────────────────────────┬───────────────┘
        │                                          │
┌───────▼──────────┐                    ┌──────────▼───────────┐
│   AGENT RUNTIME  │  × 4-5 instances   │    WORLD STATE       │
│  ┌────────────┐  │                    │  regions graph       │
│  │ Perceiver  │  │                    │  agent registry      │
│  ├────────────┤  │                    │  resource pools      │
│  │  Decider   │  │                    │  relationship graph  │
│  │   (local)  │  │                    │  tool registry       │
│  ├────────────┤  │                    │  currency registry   │
│  │  Executor  │  │                    └──────────────────────┘
│  ├────────────┤  │
│  │  Memory    │  │
│  │ (ChromaDB) │  │
│  └────────────┘  │
└──────────────────┘
```

---

## Current Status

| Layer | Goal | Status |
|-------|------|--------|
| **Layer 0** | Single agent breathing loop | ✅ Complete — all tests passed |
| **Layer 1** | Multi-agent MVP (4-5 agents, event bus, world state) | 🔄 In progress |
| **Layer 2** | Tool creation, council, synthetic currencies | 📋 Planned |
| **Layer 3** | Full emergence — factions, private languages, economies | 📋 Planned |

**Layer 0 results:** Agent ran 50+ iterations without crash, made valid tool calls, explored multiple locations, referenced past actions, developed apparent goals, maintained consistent identity.

---

## Getting Started

### Prerequisites

- Python 3.13+
- [Ollama](https://ollama.ai) with your chosen model pulled

### Install

```bash
git clone https://github.com/safimuhammad/vivarium
cd vivarium
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

### Run

> 🚧 **Project in progress** — entry point coming in Layer 1.

### Configure the world

Edit `config/world.yaml` to define regions, resource rates, and starting agent placements.

---

## Research Questions

This project is designed to study emergent behavior in LLM agents without predefined tasks:

- How long before stable social structures emerge?
- What triggers cooperation vs. defection?
- Do agents develop deception without being taught?
- Can agents create genuinely novel protocols?
- What causes population collapse vs. stability?

All events are logged for post-hoc analysis. Memory snapshots, relationship graphs, and communication patterns are tracked over time.

---

## Project Layout

```
vivarium/
├── world/          # World state, regions, resource mechanics
├── bus/            # Event bus (LOCAL / GLOBAL / TARGETED routing)
├── tools/          # Tool registry + built-in tools
├── agents/         # Breathing loop, perceiver, decider, executor
├── memory/         # ChromaDB RAG + identity summary service
├── orchestrator/   # Orchestrator runtime + council mechanics
├── dashboard/      # FastAPI backend + React/D3 observation UI
├── config/         # world.yaml, agent personas, settings
└── tests/          # Layer 0 prototypes (breathing loop validated)
```

---

<div align="center">

*Built by Safi · Layer 0 validated · Layer 1 in progress*

</div>
