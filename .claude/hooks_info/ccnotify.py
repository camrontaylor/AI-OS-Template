#!/usr/bin/env python3
"""
Claude Code Notify
https://github.com/dazuiba/CCNotify
"""

import json
import logging
import os
import platform
import sqlite3
import subprocess
import sys
import base64
import tempfile
from datetime import datetime
from logging.handlers import TimedRotatingFileHandler

ATTENTION_NOTIFICATION_KINDS = {"waiting", "permission", "actionRequired"}
PROMPT_LIKE_PREFIXES = (
    "please ",
    "can you ",
    "could you ",
    "would you ",
    "i want to ",
    "i need to ",
    "help me ",
    "let's ",
    "lets ",
)


class ClaudePromptTracker:
    def __init__(self):
        """Initialize the prompt tracker with database and paths."""
        script_dir = os.path.dirname(os.path.abspath(__file__))
        self.script_dir = script_dir
        self.project_dir = os.path.dirname(os.path.dirname(script_dir))
        self.db_path = os.path.join(script_dir, "ccnotify.db")
        self.command_centre_dir = os.path.join(self.project_dir, ".command-centre")
        self.command_centre_db_path = os.path.join(
            self.command_centre_dir, "data.db"
        )
        self.windows_notify_script = os.path.join(
            self.project_dir, "scripts", "windows-notify.ps1"
        )
        self.setup_logging()
        self.init_database()

    def setup_logging(self):
        """Setup logging to file with daily rotation."""
        log_path = os.path.join(self.script_dir, "ccnotify.log")

        handler = TimedRotatingFileHandler(
            log_path,
            when="midnight",
            interval=1,
            backupCount=1,
            encoding="utf-8",
        )

        formatter = logging.Formatter(
            "%(asctime)s - %(levelname)s - %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
        )
        handler.setFormatter(formatter)

        logger = logging.getLogger()
        logger.setLevel(logging.INFO)
        if not logger.handlers:
            logger.addHandler(handler)

    def init_database(self):
        """Create tables and triggers if they don't exist."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS prompt (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    prompt TEXT,
                    cwd TEXT,
                    seq INTEGER,
                    stoped_at DATETIME,
                    lastWaitUserAt DATETIME,
                    lastNotificationKind TEXT
                )
            """
            )

            columns = {
                row[1] for row in conn.execute("PRAGMA table_info(prompt)").fetchall()
            }
            if "lastNotificationKind" not in columns:
                conn.execute(
                    "ALTER TABLE prompt ADD COLUMN lastNotificationKind TEXT"
                )

            conn.execute(
                """
                CREATE TRIGGER IF NOT EXISTS auto_increment_seq
                AFTER INSERT ON prompt
                FOR EACH ROW
                BEGIN
                    UPDATE prompt
                    SET seq = (
                        SELECT COALESCE(MAX(seq), 0) + 1
                        FROM prompt
                        WHERE session_id = NEW.session_id
                    )
                    WHERE id = NEW.id;
                END
            """
            )

            conn.commit()

    def handle_user_prompt_submit(self, data):
        """Handle UserPromptSubmit event by inserting a new prompt row."""
        session_id = data.get("session_id")
        prompt = data.get("prompt", "")
        cwd = data.get("cwd", "")

        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO prompt (session_id, prompt, cwd)
                VALUES (?, ?, ?)
            """,
                (session_id, prompt, cwd),
            )
            conn.commit()

        logging.info("Recorded prompt for session %s", session_id)

    def handle_stop(self, data):
        """Handle Stop event by closing the latest prompt and notifying."""
        session_id = data.get("session_id")
        record = self.get_latest_prompt_record(session_id, unfinished_only=True)
        if not record:
            logging.info("Stop received for session %s with no unfinished prompt", session_id)
            return

        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                UPDATE prompt
                SET stoped_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """,
                (record["id"],),
            )
            conn.commit()

        if record.get("lastNotificationKind") in ATTENTION_NOTIFICATION_KINDS:
            logging.info(
                "Skipping complete notification for session %s because the task already asked for attention (%s)",
                session_id,
                record.get("lastNotificationKind"),
            )
            return

        duration = self.calculate_duration_from_db(record["id"])
        windows_context = self.build_windows_context(
            session_id=session_id,
            record=record,
            cwd=record.get("cwd"),
            duration_text=duration,
            assistant_message=data.get("last_assistant_message", ""),
        )

        complete_message = (
            f"{windows_context['jobLabel']} finished in {duration}."
            if duration != "Unknown"
            else f"{windows_context['jobLabel']} finished."
        )

        self.send_notification(
            title=windows_context["folderLabel"],
            subtitle="Task complete",
            message=complete_message,
            variant="success",
            duration="short",
            windows_channel="interactive",
            windows_event="complete",
            windows_context=windows_context,
        )

        logging.info(
            "Task completed for session %s, job#%s, duration: %s",
            session_id,
            record.get("seq") or "?",
            duration,
        )

    def handle_notification(self, data):
        """Handle Notification event with Windows-aware dedupe and mapping."""
        session_id = data.get("session_id")
        raw_message = data.get("message", "")
        message = self.normalize_message(raw_message)
        record = self.get_latest_prompt_record(session_id)
        cwd = data.get("cwd") or (record.get("cwd") if record else "")

        logging.info("[NOTIFICATION] session=%s, message='%s'", session_id, message)

        message_lower = message.lower()
        subtitle = "Notification"
        body = message or "Claude sent an update."
        variant = "info"
        duration = "short"
        windows_event = "actionRequired"

        if "waiting for your input" in message_lower or "waiting for input" in message_lower:
            if record and not self.mark_notification_kind(session_id, "waiting", dedupe=True):
                logging.info(
                    "Duplicate waiting notification suppressed for session %s",
                    session_id,
                )
                return
            subtitle = "Waiting for input"
            body = "Claude is paused until you reply."
            variant = "info"
            duration = "long"
            windows_event = "waiting"
        elif "permission" in message_lower:
            if record:
                self.mark_notification_kind(session_id, "permission")
            subtitle = "Permission required"
            variant = "warning"
            duration = "long"
            windows_event = "permission"
        elif "approval" in message_lower or "choose an option" in message_lower:
            if record:
                self.mark_notification_kind(session_id, "actionRequired")
            subtitle = "Action required"
            variant = "warning"
            duration = "long"
            windows_event = "actionRequired"
        else:
            if record:
                self.mark_notification_kind(session_id, "actionRequired")

        duration_text = (
            self.calculate_duration(record["created_at"], datetime.utcnow().isoformat())
            if record
            else "Unknown"
        )
        windows_context = self.build_windows_context(
            session_id=session_id,
            record=record,
            cwd=cwd,
            raw_message=body,
            duration_text=duration_text,
        )

        self.send_notification(
            title=windows_context["folderLabel"],
            subtitle=subtitle,
            message=body,
            variant=variant,
            duration=duration,
            windows_channel="interactive",
            windows_event=windows_event,
            windows_context=windows_context,
        )

        logging.info(
            "Notification processed for session %s: %s (%s)",
            session_id,
            subtitle,
            variant,
        )

    def get_latest_prompt_record(self, session_id, unfinished_only=False):
        """Return the latest prompt row for a session."""
        query = """
            SELECT id, created_at, prompt, cwd, seq, stoped_at, lastWaitUserAt, lastNotificationKind
            FROM prompt
            WHERE session_id = ?
        """
        if unfinished_only:
            query += " AND stoped_at IS NULL"
        query += " ORDER BY created_at DESC LIMIT 1"

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(query, (session_id,))
            row = cursor.fetchone()

        if not row:
            return None

        return {
            "id": row[0],
            "created_at": row[1],
            "prompt": row[2],
            "cwd": row[3],
            "seq": row[4],
            "stoped_at": row[5],
            "lastWaitUserAt": row[6],
            "lastNotificationKind": row[7],
        }

    def mark_notification_kind(self, session_id, kind, dedupe=False):
        """Track the latest notification kind for the unfinished prompt."""
        params = [kind]
        set_parts = ["lastNotificationKind = ?"]
        if kind == "waiting":
            set_parts.append("lastWaitUserAt = CURRENT_TIMESTAMP")

        query = f"""
                UPDATE prompt
                SET {", ".join(set_parts)}
                WHERE id = (
                    SELECT id
                    FROM prompt
                    WHERE session_id = ? AND stoped_at IS NULL
                    ORDER BY created_at DESC
                    LIMIT 1
                )
            """
        params.append(session_id)
        if dedupe:
            query += " AND (lastNotificationKind IS NULL OR lastNotificationKind != ?)"
            params.append(kind)

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(query, tuple(params))
            conn.commit()
            return cursor.rowcount > 0

    def calculate_duration_from_db(self, record_id):
        """Calculate duration for a completed record."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                """
                SELECT created_at, stoped_at
                FROM prompt
                WHERE id = ?
            """,
                (record_id,),
            )
            row = cursor.fetchone()

        if row and row[1]:
            return self.calculate_duration(row[0], row[1])

        return "Unknown"

    def calculate_duration(self, start_time, end_time):
        """Calculate human-readable duration between two timestamps."""
        try:
            if isinstance(start_time, str):
                start_dt = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            else:
                start_dt = datetime.fromisoformat(start_time)

            if isinstance(end_time, str):
                end_dt = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
            else:
                end_dt = datetime.fromisoformat(end_time)

            duration = end_dt - start_dt
            total_seconds = int(duration.total_seconds())

            if total_seconds < 60:
                return f"{total_seconds}s"
            if total_seconds < 3600:
                minutes = total_seconds // 60
                seconds = total_seconds % 60
                return f"{minutes}m{seconds}s" if seconds > 0 else f"{minutes}m"

            hours = total_seconds // 3600
            minutes = (total_seconds % 3600) // 60
            return f"{hours}h{minutes}m" if minutes > 0 else f"{hours}h"
        except Exception as error:
            logging.error("Error calculating duration: %s", error)
            return "Unknown"

    def build_windows_context(
        self,
        session_id,
        record,
        cwd="",
        raw_message="",
        duration_text="Unknown",
        assistant_message="",
    ):
        """Capture stable Windows click and copy data at send time."""
        session_bridge = self.get_session_bridge(session_id)
        task_row = self.get_command_centre_task(
            task_id=session_bridge.get("taskId"),
            session_id=session_id,
        )
        effective_cwd = cwd or (record.get("cwd") if record else "") or ""
        folder_label = self.folder_label(effective_cwd, task_row=task_row)
        task_id = (task_row or {}).get("id") or session_bridge.get("taskId") or ""
        sync_mode = session_bridge.get("syncMode", "")
        job_label = self.resolve_job_label(
            record, task_row, task_id=task_id,
            assistant_message=assistant_message, sync_mode=sync_mode,
        )
        port = (
            session_bridge.get("port")
            or self.command_centre_port()
        )

        return {
            "sessionId": session_id or "",
            "taskId": task_id,
            "port": str(port or ""),
            "cwd": effective_cwd,
            "folderLabel": folder_label,
            "jobLabel": job_label,
            "durationText": duration_text if duration_text != "Unknown" else "unknown time",
            "rawMessage": raw_message or "",
        }

    def send_notification(
        self,
        title,
        subtitle,
        message,
        variant="info",
        duration="short",
        windows_channel=None,
        windows_event=None,
        windows_context=None,
    ):
        """Send a native notification and log the real delivery channel."""
        system = platform.system()

        try:
            if system == "Darwin":
                self._notify_macos(title, subtitle, message)
                logging.info("Notification sent: %s - %s", title, subtitle)
                return

            if system == "Windows":
                result = self._notify_windows(
                    title,
                    subtitle,
                    message,
                    variant,
                    duration,
                    channel=windows_channel,
                    event=windows_event,
                    context=windows_context,
                )
                delivery = result.get("delivery", "unknown")
                effective_title = result.get("display_name", title)
                effective_subtitle = result.get("status", subtitle)
                if delivery != "toast":
                    logging.warning(
                        "Windows notification used %s fallback for %s - %s: %s",
                        delivery,
                        effective_title,
                        effective_subtitle,
                        result.get("toast_error", "unknown toast error"),
                    )
                logging.info(
                    "Notification sent: %s - %s via %s",
                    effective_title,
                    effective_subtitle,
                    delivery,
                )
                return

            logging.warning("Notifications not supported on %s", system)
        except Exception as error:
            logging.error("Error sending notification: %s", error)

    def _notify_macos(self, title, subtitle, message):
        """Send notification via osascript (built into macOS)."""
        script = (
            f'display notification "{self.escape_applescript(message)}" '
            f'with title "{self.escape_applescript(title)}" '
            f'subtitle "{self.escape_applescript(subtitle)}" '
            f'sound name "default"'
        )
        result = subprocess.run(
            ["osascript", "-e", script],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "osascript failed")

    def _notify_windows(
        self,
        title,
        subtitle,
        message,
        variant,
        duration,
        channel=None,
        event=None,
        context=None,
    ):
        """Send a Windows notification through the shared PowerShell helper."""
        if not os.path.exists(self.windows_notify_script):
            raise FileNotFoundError(
                f"windows-notify.ps1 not found at {self.windows_notify_script}"
            )

        command = [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            self.windows_notify_script,
        ]

        if channel and event:
            context_base64 = base64.b64encode(
                json.dumps(context or {}, separators=(",", ":")).encode("utf-8")
            ).decode("ascii")
            command.extend(
                [
                    "-Channel",
                    channel,
                    "-Event",
                    event,
                    "-ContextBase64",
                    context_base64,
                ]
            )
        else:
            command.extend(
                [
                    "-Variant",
                    variant,
                    "-Title",
                    title,
                    "-Subtitle",
                    subtitle,
                    "-Message",
                    message,
                    "-Attribution",
                    "AI-OS",
                    "-Duration",
                    duration,
                ]
            )

        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )

        stdout = result.stdout.strip()
        stderr = result.stderr.strip()

        if result.returncode != 0:
            raise RuntimeError(
                f"windows-notify exited {result.returncode}: {stderr or stdout or 'no output'}"
            )

        parsed = {}
        if stdout:
            try:
                parsed = json.loads(stdout)
            except json.JSONDecodeError:
                parsed = {"ok": True, "delivery": "unknown", "raw_stdout": stdout}

        if stderr:
            logging.warning("windows-notify stderr: %s", stderr)

        return parsed

    def get_session_bridge(self, session_id):
        """Read the temp session mapping written by session-sync.js."""
        if not session_id:
            return {}

        tmp_path = os.path.join(tempfile.gettempdir(), f"cc-session-{session_id}.json")
        try:
            with open(tmp_path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            if isinstance(data, dict):
                return data
        except FileNotFoundError:
            return {}
        except Exception as error:
            logging.warning("Failed to read session bridge for %s: %s", session_id, error)
        return {}

    def get_command_centre_task(self, task_id=None, session_id=None):
        """Read the current command-centre task row when available."""
        if not os.path.exists(self.command_centre_db_path):
            return None

        try:
            with sqlite3.connect(self.command_centre_db_path) as conn:
                conn.row_factory = sqlite3.Row
                row = None
                if task_id:
                    row = conn.execute(
                        "SELECT id, title, clientId, claudeSessionId, activityLabel FROM tasks WHERE id = ?",
                        (task_id,),
                    ).fetchone()
                if row is None and session_id:
                    row = conn.execute(
                        """
                        SELECT id, title, clientId, claudeSessionId, activityLabel
                        FROM tasks
                        WHERE claudeSessionId = ?
                        ORDER BY updatedAt DESC
                        LIMIT 1
                        """,
                        (session_id,),
                    ).fetchone()
                return dict(row) if row else None
        except Exception as error:
            logging.warning("Failed to read command-centre task data: %s", error)
            return None

    def get_latest_task_output_filename(self, task_id):
        """Return the newest output file name for a task, when one exists."""
        if not task_id or not os.path.exists(self.command_centre_db_path):
            return ""

        try:
            with sqlite3.connect(self.command_centre_db_path) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    """
                    SELECT fileName
                    FROM task_outputs
                    WHERE taskId = ?
                    ORDER BY createdAt DESC, id DESC
                    LIMIT 1
                    """,
                    (task_id,),
                ).fetchone()
                return self.normalize_message((row["fileName"] if row else "") or "")
        except Exception as error:
            logging.warning("Failed to read task output data for %s: %s", task_id, error)
            return ""

    def command_centre_port(self):
        """Return the command-centre port if known."""
        if os.environ.get("COMMAND_CENTRE_PORT"):
            return os.environ["COMMAND_CENTRE_PORT"]

        port_path = os.path.join(self.command_centre_dir, "port")
        try:
            with open(port_path, "r", encoding="utf-8") as handle:
                return handle.read().strip() or "3000"
        except FileNotFoundError:
            return "3000"
        except Exception as error:
            logging.warning("Failed to read command-centre port: %s", error)
            return "3000"

    def resolve_job_label(self, record, task_row, task_id="", assistant_message="", sync_mode=""):
        """Resolve the visible task label without leaking prompt text into the toast."""
        prompt = (record or {}).get("prompt", "")

        # 1. Task title from the command centre
        task_title = self.extract_clean_task_title(
            (task_row or {}).get("title", ""),
            prompt,
        )

        # 2. Fresh label from Claude's latest response
        fresh_label = self.extract_assistant_label(assistant_message)

        # UI-created tasks (managed) have intentional titles — use them.
        # Terminal-created tasks (hook-owned) have auto-set titles from the first
        # prompt which go stale — prefer the fresh response label instead.
        is_managed = sync_mode == "managed"

        if task_title and (is_managed or not fresh_label):
            return task_title
        if fresh_label:
            return fresh_label

        # 3. Fall back to activityLabel from the DB (may be one turn stale)
        activity_label = self.normalize_message(
            (task_row or {}).get("activityLabel", "") or ""
        )
        if activity_label and activity_label not in ("Session started", "Session ended", "Waiting for input"):
            return activity_label

        # 4. Fall back to output filename
        output_file_name = self.get_latest_task_output_filename(
            task_id or (task_row or {}).get("id")
        )
        if output_file_name:
            return output_file_name

        seq = (record or {}).get("seq")
        if seq:
            return f"Job #{seq}"
        return "Current task"

    @staticmethod
    def extract_assistant_label(text):
        """Extract a concise label from Claude's response for the notification.

        Mirrors the logic in session-sync-stop.js extractLabel():
        prefer the last question, otherwise the last sentence.
        """
        if not text:
            return ""
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        if not lines:
            return ""
        # Find last line ending with ?
        for line in reversed(lines):
            if line.endswith("?"):
                clean = line.lstrip("*#->").strip().rstrip("*")
                if clean:
                    return clean[:100] if len(clean) <= 100 else clean[:97] + "..."
        # Fall back to last non-empty line
        last = lines[-1]
        clean = last.lstrip("*#->").strip().rstrip("*")
        if clean:
            return clean[:100] if len(clean) <= 100 else clean[:97] + "..."
        return ""

    def extract_clean_task_title(self, title, prompt):
        """Prefer a real task title, but reject or trim prompt-shaped titles."""
        cleaned = self.strip_task_prefix(title)
        if not cleaned:
            return ""

        comparable_prompt = self.comparable_message(prompt)
        for separator in (" — ", " - ", " | ", " :: "):
            if separator not in cleaned:
                continue
            first_part, rest = cleaned.split(separator, 1)
            first_part = self.strip_task_prefix(first_part)
            rest = self.strip_task_prefix(rest)
            if first_part and self.is_prompt_fragment(rest, comparable_prompt):
                return first_part

        if self.is_prompt_like_title(cleaned, comparable_prompt):
            return ""

        return cleaned

    def strip_task_prefix(self, text):
        """Remove label prefixes like `Task:` from a title candidate."""
        cleaned = self.normalize_message(text)
        if not cleaned:
            return ""

        lower_cleaned = cleaned.lower()
        for prefix in ("task:", "title:", "summary:", "label:"):
            if lower_cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix):].lstrip(" -—:|")
                break
        return self.normalize_message(cleaned)

    def is_prompt_fragment(self, text, comparable_prompt):
        """True when a suffix is clearly copied from the saved prompt."""
        fragment = self.comparable_message(text.rstrip(".?!").rstrip())
        if not fragment or not comparable_prompt:
            return False
        if len(fragment) < 18:
            return False
        return comparable_prompt.startswith(fragment) or fragment in comparable_prompt

    def is_prompt_like_title(self, title, comparable_prompt):
        """Reject titles that are obviously just the raw user prompt."""
        if not title:
            return False

        lower_title = title.lower()
        if lower_title.startswith(PROMPT_LIKE_PREFIXES):
            return True

        comparable_title = self.comparable_message(title[:-3] if title.endswith("...") else title)
        if not comparable_title or not comparable_prompt:
            return False

        if comparable_title == comparable_prompt:
            return True

        if comparable_prompt.startswith(comparable_title):
            word_count = len(title.split())
            if word_count > 8 or len(title) > 60 or title.endswith(("...", ".", "?", "!")):
                return True

        return False

    @staticmethod
    def comparable_message(message):
        """Normalize text for loose equality checks between titles and prompts."""
        normalized = ClaudePromptTracker.normalize_message(message).lower()
        return "".join(ch for ch in normalized if ch.isalnum())

    def folder_label(self, cwd, task_row=None):
        """Use the client folder when present, otherwise the root workspace name."""
        client_id = (task_row or {}).get("clientId")
        if client_id:
            return client_id

        normalized_cwd = os.path.normpath(cwd or "")
        if normalized_cwd:
            clients_root = os.path.join(self.project_dir, "clients")
            try:
                rel_to_clients = os.path.relpath(normalized_cwd, clients_root)
                if not rel_to_clients.startswith(".."):
                    return rel_to_clients.split(os.sep, 1)[0]
            except ValueError:
                pass

            try:
                rel_to_root = os.path.relpath(normalized_cwd, self.project_dir)
                if not rel_to_root.startswith(".."):
                    return os.path.basename(os.path.normpath(self.project_dir))
            except ValueError:
                pass

            return os.path.basename(normalized_cwd) or "AI-OS"

        return os.path.basename(os.path.normpath(self.project_dir)) or "AI-OS"

    @staticmethod
    def project_label(cwd):
        """Build the first-line title from the current project/worktree name."""
        if not cwd:
            return "Claude Task"
        return os.path.basename(os.path.normpath(cwd)) or "Claude Task"

    @staticmethod
    def normalize_message(message):
        """Collapse whitespace so notification bodies stay compact."""
        return " ".join((message or "").split()).strip()

    @staticmethod
    def escape_applescript(value):
        """Escape text for inline AppleScript strings."""
        return (value or "").replace("\\", "\\\\").replace('"', '\\"')


def validate_input_data(data, expected_event_name):
    """Validate input data matches design specification."""
    required_fields = {
        "UserPromptSubmit": ["session_id", "prompt", "cwd", "hook_event_name"],
        "Stop": ["session_id", "hook_event_name"],
        "Notification": ["session_id", "message", "hook_event_name"],
    }

    if expected_event_name not in required_fields:
        raise ValueError(f"Unknown event type: {expected_event_name}")

    if data.get("hook_event_name") != expected_event_name:
        raise ValueError(
            f"Event name mismatch: expected {expected_event_name}, got {data.get('hook_event_name')}"
        )

    missing_fields = []
    for field in required_fields[expected_event_name]:
        if field not in data or data[field] is None:
            missing_fields.append(field)

    if missing_fields:
        raise ValueError(
            f"Missing required fields for {expected_event_name}: {missing_fields}"
        )

    return True


def main():
    """Main entry point - read JSON from stdin and process event."""
    try:
        if len(sys.argv) < 2:
            print("ok")
            return

        expected_event_name = sys.argv[1]
        valid_events = ["UserPromptSubmit", "Stop", "Notification"]

        if expected_event_name not in valid_events:
            logging.error("Invalid hook type: %s", expected_event_name)
            logging.error("Valid hook types: %s", ", ".join(valid_events))
            sys.exit(1)

        input_data = sys.stdin.read().strip()
        if not input_data:
            logging.warning("No input data received")
            return

        data = json.loads(input_data)
        validate_input_data(data, expected_event_name)

        tracker = ClaudePromptTracker()

        if expected_event_name == "UserPromptSubmit":
            tracker.handle_user_prompt_submit(data)
        elif expected_event_name == "Stop":
            tracker.handle_stop(data)
        elif expected_event_name == "Notification":
            tracker.handle_notification(data)

    except json.JSONDecodeError as error:
        logging.error("JSON decode error: %s", error)
        sys.exit(1)
    except ValueError as error:
        logging.error("Validation error: %s", error)
        sys.exit(1)
    except Exception as error:
        logging.error("Unexpected error: %s", error)
        sys.exit(1)


if __name__ == "__main__":
    main()
