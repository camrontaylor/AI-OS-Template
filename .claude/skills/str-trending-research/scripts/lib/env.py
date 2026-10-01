"""Environment and API key management for last30days skill.

Adapted from https://github.com/Ronnie-Nutrition/last30days-skill
Modified for AI-OS: reads from project .env instead of ~/.config/last30days/.env
"""

import os
from pathlib import Path
from typing import Optional, Dict, Any

# AI-OS: find project .env by walking up from script location
def _find_project_env() -> Path:
    """Find the project .env file by walking up from this script."""
    current = Path(__file__).resolve().parent
    for _ in range(10):  # Safety limit
        env_path = current / ".env"
        if env_path.exists():
            return env_path
        agents_md = current / "AGENTS.md"
        claude_md = current / "CLAUDE.md"
        if agents_md.exists() or claude_md.exists():
            return current / ".env"  # Project root found
        current = current.parent
    return Path.cwd() / ".env"  # Fallback

CONFIG_FILE = _find_project_env()


def load_env_file(path: Path) -> Dict[str, str]:
    """Load environment variables from a file."""
    env = {}
    if not path.exists():
        return env

    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                key, _, value = line.partition('=')
                key = key.strip()
                value = value.strip()
                if value and value[0] in ('"', "'") and value[-1] == value[0]:
                    value = value[1:-1]
                if key and value:
                    env[key] = value
    return env


def get_config() -> Dict[str, Any]:
    """Load configuration from project .env and environment."""
    file_env = load_env_file(CONFIG_FILE)

    config = {
        'OPENAI_API_KEY': os.environ.get('OPENAI_API_KEY') or file_env.get('OPENAI_API_KEY'),
        'XAI_API_KEY': os.environ.get('XAI_API_KEY') or file_env.get('XAI_API_KEY'),
        'OPENAI_MODEL_POLICY': os.environ.get('OPENAI_MODEL_POLICY') or file_env.get('OPENAI_MODEL_POLICY', 'auto'),
        'OPENAI_MODEL_PIN': os.environ.get('OPENAI_MODEL_PIN') or file_env.get('OPENAI_MODEL_PIN'),
        'XAI_MODEL_POLICY': os.environ.get('XAI_MODEL_POLICY') or file_env.get('XAI_MODEL_POLICY', 'latest'),
        'XAI_MODEL_PIN': os.environ.get('XAI_MODEL_PIN') or file_env.get('XAI_MODEL_PIN'),
    }

    return config


def config_exists() -> bool:
    """Check if configuration file exists."""
    return CONFIG_FILE.exists()


def get_available_sources(config: Dict[str, Any]) -> str:
    """Determine which sources are available.

    Reddit no longer depends on an API key: the keyless tiers (RSS discovery,
    arctic-shift score backfill, shreddit comments) always run. Only X still
    needs a key, so the question is just whether X joins Reddit or not.
    """
    has_xai = bool(config.get('XAI_API_KEY'))
    return 'both' if has_xai else 'reddit'


def get_missing_keys(config: Dict[str, Any]) -> str:
    """Determine which API keys are missing."""
    has_xai = bool(config.get('XAI_API_KEY'))

    # Reddit runs keyless now, so a missing OpenAI key is no longer a gap.
    return 'none' if has_xai else 'x'


def validate_sources(requested: str, available: str, include_web: bool = False) -> tuple:
    """Validate requested sources against available keys."""
    if available == 'web':
        if requested == 'auto':
            return 'web', None
        elif requested == 'web':
            return 'web', None
        else:
            return 'web', f"No API keys configured. Using WebSearch fallback. Add OPENAI_API_KEY and/or XAI_API_KEY to your .env file."

    if requested == 'auto':
        if include_web:
            if available == 'both':
                return 'all', None
            elif available == 'reddit':
                return 'reddit-web', None
            elif available == 'x':
                return 'x-web', None
        return available, None

    if requested == 'web':
        return 'web', None

    if requested == 'both':
        if available not in ('both',):
            missing = 'xAI' if available == 'reddit' else 'OpenAI'
            return 'none', f"Requested both sources but {missing} key is missing."
        if include_web:
            return 'all', None
        return 'both', None

    if requested == 'reddit':
        if available == 'x':
            return 'none', "Requested Reddit but only xAI key is available."
        if include_web:
            return 'reddit-web', None
        return 'reddit', None

    if requested == 'x':
        if available == 'reddit':
            return 'none', "Requested X but only OpenAI key is available."
        if include_web:
            return 'x-web', None
        return 'x', None

    return requested, None
