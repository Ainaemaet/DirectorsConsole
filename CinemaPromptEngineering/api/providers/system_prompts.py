"""System prompts for LLM enhancement per target image/video model.

Each target model has specific syntax, keywords, and formatting that the LLM
should use when enhancing prompts for optimal results.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Dict, List


logger = logging.getLogger(__name__)

_SAFE_ID_RE = re.compile(r"^[a-zA-Z0-9._-]+$")


# =============================================================================
# AVAILABLE TARGET MODELS (for dropdown population)
# =============================================================================

TARGET_MODELS: List[Dict[str, str]] = [
    # Generic
    {"id": "generic", "name": "Generic", "category": "General"},

    # Image Generation Models
    {"id": "midjourney", "name": "Midjourney", "category": "Image"},
    {"id": "flux.1", "name": "FLUX.1", "category": "Image"},
    {"id": "flux.1_pro", "name": "FLUX.1 Pro", "category": "Image"},
    {"id": "flux_kontext", "name": "Flux Kontext", "category": "Image"},
    {"id": "flux_krea", "name": "Flux Krea", "category": "Image"},
    {"id": "dall-e_3", "name": "DALL-E 3", "category": "Image"},
    {"id": "gpt-image", "name": "GPT-Image (4o)", "category": "Image"},
    {"id": "ideogram_2.0", "name": "Ideogram 2.0", "category": "Image"},
    {"id": "leonardo_ai", "name": "Leonardo AI", "category": "Image"},
    {"id": "sdxl", "name": "Stable Diffusion XL", "category": "Image"},
    {"id": "stable_diffusion_3", "name": "Stable Diffusion 3", "category": "Image"},
    {"id": "z-image_turbo", "name": "Z-Image Turbo", "category": "Image"},
    {"id": "qwen_image", "name": "Qwen-Image", "category": "Image"},

    # Video Generation Models
    {"id": "sora", "name": "Sora", "category": "Video"},
    {"id": "sora_2", "name": "Sora 2", "category": "Video"},
    {"id": "veo_2", "name": "Veo 2", "category": "Video"},
    {"id": "veo_3", "name": "Veo 3", "category": "Video"},
    {"id": "runway_gen-3", "name": "Runway Gen-3", "category": "Video"},
    {"id": "runway_gen-4", "name": "Runway Gen-4", "category": "Video"},
    {"id": "kling_1.6", "name": "Kling 1.6", "category": "Video"},
    {"id": "pika_2.0", "name": "Pika 2.0", "category": "Video"},
    {"id": "luma_dream_machine", "name": "Luma Dream Machine", "category": "Video"},
    {"id": "ltx_2", "name": "LTX-2", "category": "Video"},
    {"id": "cogvideox", "name": "CogVideoX", "category": "Video"},
    {"id": "hunyuan", "name": "Hunyuan Video", "category": "Video"},
    {"id": "wan_2.1", "name": "Wan 2.1", "category": "Video"},
    {"id": "wan_2.2", "name": "Wan 2.2", "category": "Video"},
    {"id": "minimax_video", "name": "Minimax Video", "category": "Video"},
    {"id": "qwen_vl", "name": "Qwen VL", "category": "Video"},
]

MODEL_CATEGORY_BY_ID: dict[str, str] = {
    entry["id"]: entry["category"] for entry in TARGET_MODELS
}


# =============================================================================
# TARGET MODEL ALIASES
# =============================================================================

MODEL_ID_ALIASES: dict[str, str] = {
    "flux": "flux.1",
    "wan2.1": "wan_2.1",
    "wan2.2": "wan_2.2",
    "runway": "runway_gen-4",
    "pika": "pika_2.0",
    "cogvideo": "cogvideox",
    "ltx": "ltx_2",
}


PROMPTS_DIR = Path(__file__).parent / "system_prompts"
MODEL_PROMPTS_DIR = PROMPTS_DIR / "model_prompts"
GENERAL_PROMPT_PATH = PROMPTS_DIR / "general.md"


def get_target_models() -> List[Dict[str, str]]:
    """Get list of available target models for dropdown population."""
    return TARGET_MODELS


def _normalize_target_model(target_model: str) -> str:
    """Normalize target model IDs to match known prompt files."""
    model_key = target_model.lower().strip()
    return MODEL_ID_ALIASES.get(model_key, model_key)


def _read_prompt_file(path: Path) -> str:
    """Read a prompt file, returning an empty string if missing."""
    try:
        return path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        logger.warning("Prompt file missing: %s", path)
        return ""


def get_model_category(target_model: str) -> str | None:
    """Get the category for a target model.

    Args:
        target_model: The target image/video model (e.g., 'midjourney', 'runway')

    Returns:
        The category name or None if unknown.
    """
    model_key = _normalize_target_model(target_model)
    return MODEL_CATEGORY_BY_ID.get(model_key)


def is_video_model(target_model: str) -> bool:
    """Return True if the target model is a video generator."""
    return get_model_category(target_model) == "Video"


def is_image_model(target_model: str) -> bool:
    """Return True if the target model is an image generator."""
    return get_model_category(target_model) == "Image"


def get_system_prompt(target_model: str, project_type: str = "live_action") -> str:
    """Get the system prompt for a specific target model and project type.

    Args:
        target_model: The target image/video model (e.g., 'midjourney', 'runway')
        project_type: 'live_action' or 'animation'

    Returns:
        The system prompt string for that model, or generic if not found.
    """
    model_key = _normalize_target_model(target_model)
    general_prompt = _read_prompt_file(GENERAL_PROMPT_PATH)
    model_prompt = ""
    if model_key != "generic":
        model_prompt = _read_prompt_file(MODEL_PROMPTS_DIR / f"{model_key}.md")

    if model_prompt and general_prompt:
        return f"{general_prompt}\n\n{model_prompt}"
    if model_prompt:
        return model_prompt
    return general_prompt


def format_config_context(
    config: dict,
    project_type: str,
    target_model: str | None = None,
) -> str:
    """Format the cinematic configuration into context for the LLM.

    Args:
        config: The live-action or animation configuration dict
        project_type: 'live_action' or 'animation'

    Returns:
        A formatted string describing the cinematic settings.
    """
    include_motion = True
    if target_model and is_image_model(target_model):
        include_motion = False

    if project_type == "live_action":
        return _format_live_action_context(config, include_motion=include_motion)
    return _format_animation_context(config, include_motion=include_motion)


def _format_live_action_context(config: dict, include_motion: bool) -> str:
    """Format live-action configuration for LLM context.

    Equipment names are translated to perspective/motion language to prevent
    AI models from rendering the equipment itself in the generated image/video.
    """
    camera = config.get("camera", {})
    lens = config.get("lens", {})
    movement = config.get("movement", {})
    lighting = config.get("lighting", {})
    visual = config.get("visual_grammar", {})

    parts: list[str] = []

    # Camera & Lens - OK to include as quality descriptors (not objects in scene)
    if camera.get("body"):
        parts.append(f"Shot with {camera['body'].replace('_', ' ')} camera")
    if lens.get("focal_length_mm"):
        parts.append(f"with a {lens['focal_length_mm']}mm focal length")
    if lens.get("is_anamorphic"):
        parts.append("anamorphic")

    # Shot & Composition
    if visual.get("shot_size"):
        shot_names = {
            "EWS": "Extreme Wide Shot", "WS": "Wide Shot", "MWS": "Medium Wide Shot",
            "MS": "Medium Shot", "MCU": "Medium Close-Up", "CU": "Close-Up",
            "BCU": "Big Close-Up", "ECU": "Extreme Close-Up", "OTS": "Over-The-Shoulder",
            "POV": "Point-of-View",
        }
        parts.append(f"Shot: {shot_names.get(visual['shot_size'], visual['shot_size'])}")
    if visual.get("composition"):
        parts.append(f"Composition: {visual['composition'].replace('_', ' ')}")

    if include_motion:
        # Movement - translate equipment to perspective language
        equipment_to_perspective = {
            "Crane": "elevated perspective with smooth vertical motion",
            "Jib": "elevated perspective with smooth vertical motion",
            "Technocrane": "elevated perspective with extended reach and smooth motion",
            "Dolly": "gliding perspective moving through the scene",
            "Slider": "subtle lateral perspective shift",
            "Steadicam": "fluid, stabilized following perspective",
            "Gimbal": "smooth, stabilized perspective",
            "Handheld": "organic, slightly textured perspective movement",
            "Drone": "aerial elevated perspective",
            "Cable_Cam": "elevated perspective gliding overhead",
            "Motion_Control": "precisely controlled, repeatable perspective motion",
            "Vehicle_Mount": "perspective traveling with the scene",
            "Static": None,
        }

        movement_type_to_description = {
            "Crane_Up": "the view rises smoothly",
            "Crane_Down": "the view descends smoothly",
            "Dolly_In": "the perspective glides closer",
            "Dolly_Out": "the perspective glides away",
            "Track_Left": "the perspective glides left",
            "Track_Right": "the perspective glides right",
            "Pan_Left": "the view sweeps left",
            "Pan_Right": "the view sweeps right",
            "Tilt_Up": "the view tilts upward",
            "Tilt_Down": "the view tilts downward",
            "Arc_Left": "the perspective orbits left around the subject",
            "Arc_Right": "the perspective orbits right around the subject",
            "Push_In": "the perspective pushes closer",
            "Pull_Out": "the perspective pulls away",
            "Dolly_Zoom": "perspective compression effect (subject stays same size while background shifts)",
            "Roll": "the frame rotates",
            "Boom_Up": "the perspective rises vertically",
            "Boom_Down": "the perspective descends vertically",
            "Static": None,
        }

        equip_key = movement.get("equipment", "")
        motion_type = movement.get("movement_type", "")

        if equip_key and equip_key != "Static" and equip_key in equipment_to_perspective:
            perspective_desc = equipment_to_perspective[equip_key]
            if perspective_desc:
                parts.append(f"Perspective: {perspective_desc}")

        if motion_type and motion_type != "Static" and motion_type in movement_type_to_description:
            motion_desc = movement_type_to_description[motion_type]
            if motion_desc:
                parts.append(f"Motion: {motion_desc}")
        elif motion_type and motion_type != "Static":
            parts.append(f"Motion: {motion_type.replace('_', ' ').lower()}")

        if movement.get("timing") and movement.get("timing") != "Static":
            parts.append(f"Pace: {movement['timing']}")

    # Lighting - describe quality, not fixtures
    if lighting.get("time_of_day"):
        parts.append(f"Time: {lighting['time_of_day'].replace('_', ' ')}")
    if lighting.get("source"):
        source = lighting.get("source", "")
        source_translations = {
            "HMI": "bright daylight-quality illumination",
            "Tungsten": "warm tungsten illumination",
            "LED": "versatile controlled illumination",
            "Kinoflo": "soft diffused illumination",
            "Fluorescent": "soft even illumination",
            "Practicals": "motivated practical light sources in scene",
            "Natural": "natural ambient light",
            "Mixed": "mixed light sources",
        }
        source_desc = source_translations.get(source, source.replace('_', ' '))
        parts.append(f"Light Quality: {source_desc}")
    if lighting.get("style"):
        parts.append(f"Lighting Style: {lighting['style'].replace('_', ' ')}")

    # Mood & Color
    if visual.get("mood"):
        parts.append(f"Mood: {visual['mood']}")
    if visual.get("color_tone"):
        parts.append(f"Color: {visual['color_tone'].replace('_', ' ')}")

    return "CINEMATOGRAPHY:\n" + "\n".join(f"- {p}" for p in parts)


def _format_animation_context(config: dict, include_motion: bool) -> str:
    """Format animation configuration for LLM context."""
    rendering = config.get("rendering", {})
    motion = config.get("motion", {})
    visual = config.get("visual_grammar", {})

    parts: list[str] = []

    if config.get("style_domain"):
        parts.append(f"Style: {config['style_domain']}")
    if config.get("medium"):
        parts.append(f"Medium: {config['medium']}")

    if rendering.get("line_treatment"):
        parts.append(f"Lines: {rendering['line_treatment']}")
    if rendering.get("color_application"):
        parts.append(f"Color: {rendering['color_application'].replace('_', ' ')}")
    if rendering.get("lighting_model"):
        parts.append(f"Lighting: {rendering['lighting_model'].replace('_', ' ')}")

    if include_motion:
        if motion.get("motion_style") and motion.get("motion_style") != "None":
            parts.append(f"Animation: {motion['motion_style']}")
        if motion.get("virtual_camera"):
            parts.append(f"Camera: {motion['virtual_camera'].replace('_', ' ')}")

    if visual.get("shot_size"):
        parts.append(f"Shot: {visual['shot_size']}")
    if visual.get("mood"):
        parts.append(f"Mood: {visual['mood']}")
    if visual.get("color_tone"):
        parts.append(f"Tone: {visual['color_tone']}")

    return "ANIMATION STYLE:\n" + "\n".join(f"- {p}" for p in parts)


def build_enhancement_prompt(
    user_prompt: str,
    config: dict,
    project_type: str,
    target_model: str,
) -> str:
    """Build the full prompt to send to the LLM for enhancement.

    Args:
        user_prompt: The user's basic scene description
        config: The cinematic configuration dict
        project_type: 'live_action' or 'animation'

    Returns:
        The formatted prompt for the LLM
    """
    config_context = format_config_context(config, project_type, target_model)

    return f"""TARGET MODEL:
{target_model}

USER'S SCENE IDEA:
{user_prompt}

{config_context}

CONSTRAINTS (MUST FOLLOW):
- Use the provided configuration context as authoritative; do not invent replacements.
- Do not contradict the user's scene; reconcile conflicts in favor of the provided configuration.
- If a detail is not provided, do not add it unless required by the model guide.
- Follow the system prompt's output format and structure for the target model.

Output ONLY the final prompt - no explanations, no duplicates, no examples."""


# =============================================================================
# PROMPT EDITOR HELPERS (CRUD)
# =============================================================================


def _resolve_prompt_path(prompt_id: str) -> Path:
    """Return the filesystem path for a given prompt ID.

    'general' maps to system_prompts/general.md; all other IDs map to
    system_prompts/model_prompts/{id}.md.
    """
    if prompt_id == "general":
        return GENERAL_PROMPT_PATH
    return MODEL_PROMPTS_DIR / f"{prompt_id}.md"


def _validate_prompt_id(prompt_id: str) -> None:
    """Raise ValueError if prompt_id contains unsafe characters."""
    if not _SAFE_ID_RE.match(prompt_id):
        raise ValueError(f"Invalid prompt ID '{prompt_id}': only letters, digits, '.', '_', '-' are allowed")


def list_system_prompts() -> List[Dict]:
    """Return metadata for all system prompts (general + model-specific).

    Returns:
        A list of dicts with keys: id, name, type ('general' or 'model'), exists.
    """
    results: List[Dict] = []

    # General prompt
    results.append({
        "id": "general",
        "name": "General (Base Prompt)",
        "type": "general",
        "exists": GENERAL_PROMPT_PATH.exists(),
    })

    # Model prompts — include registered models first (preserves known ordering)
    seen: set[str] = set()
    for model in TARGET_MODELS:
        mid = model["id"]
        if mid == "generic":
            continue
        path = MODEL_PROMPTS_DIR / f"{mid}.md"
        results.append({
            "id": mid,
            "name": model["name"],
            "type": "model",
            "exists": path.exists(),
        })
        seen.add(mid)

    # Also pick up any .md files that exist on disk but aren't in TARGET_MODELS
    if MODEL_PROMPTS_DIR.exists():
        for p in sorted(MODEL_PROMPTS_DIR.glob("*.md")):
            mid = p.stem
            if mid not in seen:
                results.append({
                    "id": mid,
                    "name": mid.replace("_", " ").replace("-", " ").title(),
                    "type": "model",
                    "exists": True,
                })

    return results


def write_system_prompt(prompt_id: str, content: str) -> None:
    """Overwrite the content of an existing prompt file.

    Args:
        prompt_id: The prompt identifier ('general' or a model slug).
        content: The new markdown content to write.

    Raises:
        ValueError: If prompt_id is unsafe.
        FileNotFoundError: If the prompt file does not exist yet (use create_model_prompt).
    """
    _validate_prompt_id(prompt_id)
    path = _resolve_prompt_path(prompt_id)
    if not path.exists():
        raise FileNotFoundError(f"Prompt '{prompt_id}' does not exist. Use create to add it.")
    path.write_text(content, encoding="utf-8")
    logger.info("System prompt updated: %s", path)


def create_model_prompt(prompt_id: str, content: str) -> None:
    """Create a new model-specific prompt file.

    Args:
        prompt_id: The new prompt's slug (cannot be 'general').
        content: Initial markdown content.

    Raises:
        ValueError: If prompt_id is unsafe or already exists.
    """
    if prompt_id == "general":
        raise ValueError("Cannot create a prompt with the reserved ID 'general'.")
    _validate_prompt_id(prompt_id)
    path = MODEL_PROMPTS_DIR / f"{prompt_id}.md"
    if path.exists():
        raise ValueError(f"Prompt '{prompt_id}' already exists.")
    MODEL_PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    logger.info("System prompt created: %s", path)


def delete_model_prompt(prompt_id: str) -> None:
    """Delete a model-specific prompt file.

    Args:
        prompt_id: The prompt slug to delete (cannot be 'general').

    Raises:
        ValueError: If prompt_id is 'general' or unsafe.
        FileNotFoundError: If the prompt file does not exist.
    """
    if prompt_id == "general":
        raise ValueError("The general prompt cannot be deleted.")
    _validate_prompt_id(prompt_id)
    path = MODEL_PROMPTS_DIR / f"{prompt_id}.md"
    if not path.exists():
        raise FileNotFoundError(f"Prompt '{prompt_id}' does not exist.")
    path.unlink()
    logger.info("System prompt deleted: %s", path)