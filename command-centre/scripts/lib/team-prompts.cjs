const readline = require("node:readline/promises");
const pc = require("picocolors");

let clackPromise = null;
let currentInterrupt = null;

class PromptBackError extends Error {
  constructor(message = "Back") {
    super(message);
    this.name = "PromptBackError";
    this.code = "TEAM_PROMPT_BACK";
  }
}

class PromptExitError extends Error {
  constructor(message = "Exit") {
    super(message);
    this.name = "PromptExitError";
    this.code = "TEAM_PROMPT_EXIT";
  }
}

function isPromptBack(error) {
  return error?.code === "TEAM_PROMPT_BACK";
}

function isPromptExit(error) {
  return error?.code === "TEAM_PROMPT_EXIT";
}

function isPromptCancel(error) {
  return isPromptBack(error) || isPromptExit(error);
}

function isInteractive(input = process.stdin) {
  return input.isTTY === true && typeof input.setRawMode === "function";
}

function isPromptAvailable(input = process.stdin) {
  return input.isTTY === true;
}

async function clack() {
  if (!clackPromise) clackPromise = import("@clack/prompts");
  return clackPromise;
}

function cleanQuestion(question) {
  return String(question || "").replace(/:\s*$/, "");
}

function withHint(message, hint) {
  return hint ? `${cleanQuestion(message)} (${hint})` : cleanQuestion(message);
}

function clay(value) {
  return `\x1b[38;2;192;64;48m${value}\x1b[0m`;
}

function sage(value) {
  return `\x1b[38;2;107;142;107m${value}\x1b[0m`;
}

function muted(value) {
  return pc.dim(value);
}

function restoreTerminal(input = process.stdin, output = process.stdout) {
  try {
    if (input.isTTY && typeof input.setRawMode === "function") input.setRawMode(false);
  } catch {
    // Best effort only. The process should still continue to exit cleanly.
  }
  try {
    if (output.isTTY === true) output.write("\x1B[?25h");
  } catch {
    // Best effort only.
  }
}

function createPromptInterrupt(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const forceExit = options.forceExit !== false;
  let started = false;
  let exitRequested = false;
  let activeController = null;

  const requestExit = () => {
    if (exitRequested) {
      restoreTerminal(input, output);
      if (forceExit) process.exit(130);
      return;
    }
    exitRequested = true;
    restoreTerminal(input, output);
    const controller = activeController;
    if (controller && !controller.signal.aborted) {
      setImmediate(() => controller.abort());
    }
  };

  const onSigint = () => requestExit();

  return {
    start() {
      if (started) return;
      started = true;
      process.on("SIGINT", onSigint);
    },
    stop() {
      if (!started) return;
      started = false;
      process.off("SIGINT", onSigint);
      activeController = null;
    },
    beginPrompt() {
      if (exitRequested) throw new PromptExitError("Closed Team OS.");
      const controller = new AbortController();
      activeController = controller;
      return controller;
    },
    endPrompt(controller) {
      if (activeController === controller) activeController = null;
    },
    isExitRequested() {
      return exitRequested;
    },
    throwIfExitRequested() {
      if (exitRequested) throw new PromptExitError("Closed Team OS.");
    },
    requestExit,
    restoreTerminal: () => restoreTerminal(input, output),
  };
}

function setPromptInterrupt(interrupt) {
  const previous = currentInterrupt;
  currentInterrupt = interrupt || null;
  return () => {
    currentInterrupt = previous;
  };
}

function activeInterrupt(options = {}) {
  return options.interrupt || currentInterrupt;
}

function beginPrompt(options = {}) {
  const interrupt = activeInterrupt(options);
  if (!interrupt) return { interrupt: null, controller: null, signal: options.signal };
  const controller = interrupt.beginPrompt();
  return { interrupt, controller, signal: options.signal || controller.signal };
}

function endPrompt(context) {
  context.interrupt?.endPrompt(context.controller);
}

function throwPromptCancel(interrupt) {
  if (interrupt?.isExitRequested()) throw new PromptExitError("Closed Team OS.");
  throw new PromptBackError("Cancelled.");
}

function promptStreams(options = {}) {
  return {
    input: options.input || process.stdin,
    output: options.output || process.stdout,
  };
}

function setRawMode(input, enabled) {
  try {
    if (input.isTTY && typeof input.setRawMode === "function") input.setRawMode(enabled);
  } catch {
    // Best effort only. The caller still removes listeners and resolves.
  }
}

function writeOutput(output, value) {
  if (output && typeof output.write === "function") output.write(value);
}

function keyEventsFromChunk(chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk || "");
  const events = [];
  for (let index = 0; index < text.length;) {
    if (text.startsWith("\x1b[A", index) || text.startsWith("\x1bOA", index)) {
      events.push({ name: "up" });
      index += 3;
      continue;
    }
    if (text.startsWith("\x1b[B", index) || text.startsWith("\x1bOB", index)) {
      events.push({ name: "down" });
      index += 3;
      continue;
    }
    if (text.startsWith("\x1b[C", index) || text.startsWith("\x1bOC", index)) {
      events.push({ name: "right" });
      index += 3;
      continue;
    }
    if (text.startsWith("\x1b[D", index) || text.startsWith("\x1bOD", index)) {
      events.push({ name: "left" });
      index += 3;
      continue;
    }
    if (text.startsWith("\x1b[H", index) || text.startsWith("\x1bOH", index)) {
      events.push({ name: "home" });
      index += 3;
      continue;
    }
    if (text.startsWith("\x1b[F", index) || text.startsWith("\x1bOF", index)) {
      events.push({ name: "end" });
      index += 3;
      continue;
    }
    if (text.startsWith("\x1b[3~", index)) {
      events.push({ name: "delete" });
      index += 4;
      continue;
    }

    const char = text[index];
    const code = char.charCodeAt(0);
    if (char === "\x03") events.push({ name: "ctrl-c" });
    else if (char === "\x1b") events.push({ name: "escape" });
    else if (char === "\r" || char === "\n") events.push({ name: "enter" });
    else if (char === "\x7f" || char === "\b") events.push({ name: "backspace" });
    else if (char === "\t") events.push({ name: "tab" });
    else if (char === " ") events.push({ name: "space", char });
    else if (code >= 32) events.push({ name: "char", char });
    index += 1;
  }
  return events;
}

function createFrameRenderer(output) {
  let rendered = false;
  let lineCount = 0;

  const moveToFrameStart = () => {
    writeOutput(output, "\r");
    if (lineCount > 1) writeOutput(output, `\x1b[${lineCount - 1}A`);
  };

  const clearFrame = () => {
    if (!rendered) return;
    moveToFrameStart();
    for (let index = 0; index < lineCount; index += 1) {
      writeOutput(output, "\r\x1b[2K");
      if (index < lineCount - 1) writeOutput(output, "\x1b[1B");
    }
    if (lineCount > 1) writeOutput(output, `\x1b[${lineCount - 1}A`);
    writeOutput(output, "\r");
    rendered = false;
    lineCount = 0;
  };

  return {
    render(frame) {
      const lines = String(frame || "").split("\n");
      if (rendered) moveToFrameStart();
      const total = Math.max(lineCount, lines.length);
      for (let index = 0; index < total; index += 1) {
        writeOutput(output, "\r\x1b[2K");
        if (index < lines.length) writeOutput(output, lines[index]);
        if (index < total - 1) writeOutput(output, "\n");
      }
      rendered = true;
      lineCount = lines.length;
    },
    done() {
      clearFrame();
    },
  };
}

function visibleWindow(options, cursor, maxItems = 12) {
  if (options.length <= maxItems) return { start: 0, items: options };
  const half = Math.floor(maxItems / 2);
  const start = Math.max(0, Math.min(cursor - half, options.length - maxItems));
  return { start, items: options.slice(start, start + maxItems) };
}

function optionDetail(option) {
  const detail = option?.detail || option?.hint;
  return detail ? muted(` ${detail}`) : "";
}

function terminalSelectFrame(title, options, cursor, promptOptions = {}) {
  const { start, items } = visibleWindow(options, cursor, promptOptions.maxItems || 12);
  const lines = [`${clay("?")} ${withHint(title, promptOptions.hint || "Esc back, Ctrl+C exit")}`];
  for (let index = 0; index < items.length; index += 1) {
    const absolute = start + index;
    const option = items[index];
    const marker = absolute === cursor ? clay(">") : " ";
    const label = absolute === cursor ? sage(option.label) : option.label;
    lines.push(`  ${marker} ${label}${optionDetail(option)}`);
  }
  if (options.length > items.length) {
    lines.push(muted(`  Showing ${start + 1}-${start + items.length} of ${options.length}`));
  }
  lines.push(muted("  Up/Down move, Enter select, Esc back, Ctrl+C exit"));
  return lines.join("\n");
}

function terminalMultiSelectFrame(title, options, cursor, selectedValues, promptOptions = {}) {
  const { start, items } = visibleWindow(options, cursor, promptOptions.maxItems || 12);
  const lines = [`${clay("?")} ${withHint(title, promptOptions.hint || "Esc cancel, Ctrl+C exit")}`];
  for (let index = 0; index < items.length; index += 1) {
    const absolute = start + index;
    const option = items[index];
    const checked = selectedValues.has(option.value) ? "[x]" : "[ ]";
    const marker = absolute === cursor ? clay(">") : " ";
    const label = absolute === cursor ? sage(option.label) : option.label;
    lines.push(`  ${marker} ${checked} ${label}${optionDetail(option)}`);
  }
  if (options.length > items.length) {
    lines.push(muted(`  Showing ${start + 1}-${start + items.length} of ${options.length}`));
  }
  lines.push(muted("  Up/Down move, Space toggle, Enter done, Esc cancel, Ctrl+C exit"));
  return lines.join("\n");
}

function terminalTextFrame(question, value, cursor, options = {}) {
  const hint = options.hint || "Esc cancel, Ctrl+C exit";
  const display = options.password
    ? "*".repeat(value.length)
    : value || (options.defaultValue != null ? muted(String(options.defaultValue)) : "");
  const caret = value.length === 0 && options.defaultValue == null ? muted("_") : "";
  const lines = [
    `${clay("?")} ${withHint(question, hint)}`,
    `  ${display}${caret}`,
  ];
  if (cursor < value.length) lines.push(muted(`  Cursor: ${cursor + 1}/${value.length}`));
  return lines.join("\n");
}

function terminalConfirmFrame(question, value, defaultValue, options = {}) {
  const hint = options.hint || "Esc cancel, Ctrl+C exit";
  const yes = value ? sage("Yes") : "Yes";
  const no = !value ? sage("No") : "No";
  return [
    `${clay("?")} ${withHint(question, hint)}`,
    `  ${yes} / ${no} ${muted(`default ${defaultValue ? "Yes" : "No"}`)}`,
    muted("  Left/Right toggle, Y/N choose, Enter confirm, Esc cancel, Ctrl+C exit"),
  ].join("\n");
}

function runRawPrompt(renderFrame, handleKey, options = {}) {
  const { input, output } = promptStreams(options);
  const context = beginPrompt(options);
  const renderer = createFrameRenderer(output);
  let done = false;
  let settled = false;

  return new Promise((resolve, reject) => {
    const finish = (error, value) => {
      if (done) return;
      done = true;
      input.off("data", onData);
      context.signal?.removeEventListener("abort", onAbort);
      renderer.done();
      restoreTerminal(input, output);
      endPrompt(context);
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    const back = () => finish(new PromptBackError("Cancelled."));
    const exit = () => {
      context.interrupt?.requestExit();
      finish(new PromptExitError("Closed Team OS."));
    };
    const rerender = () => {
      if (!done) renderer.render(renderFrame());
    };
    const onAbort = () => {
      if (context.interrupt?.isExitRequested()) finish(new PromptExitError("Closed Team OS."));
      else finish(new PromptBackError("Cancelled."));
    };
    const onData = (chunk) => {
      for (const key of keyEventsFromChunk(chunk)) {
        if (done) return;
        if (key.name === "ctrl-c") {
          exit();
          return;
        }
        if (key.name === "escape") {
          back();
          return;
        }
        let result;
        try {
          result = handleKey(key);
        } catch (error) {
          finish(error);
          return;
        }
        if (result && result.type === "submit") {
          finish(null, result.value);
          return;
        }
        if (result && result.type === "back") {
          back();
          return;
        }
        if (result && result.type === "exit") {
          exit();
          return;
        }
        try {
          rerender();
        } catch (error) {
          finish(error);
          return;
        }
      }
    };

    try {
      context.signal?.addEventListener("abort", onAbort, { once: true });
      writeOutput(output, "\x1B[?25l");
      if (typeof input.resume === "function") input.resume();
      setRawMode(input, true);
      input.on("data", onData);
      rerender();
    } catch (error) {
      if (!settled) finish(error);
    }
  });
}

function formatFallbackMenu(title, options) {
  const lines = [`\n${title}`];
  options.forEach((option, index) => {
    const detail = option.detail ? ` - ${option.detail}` : "";
    lines.push(`  ${index + 1}. ${option.label}${detail}`);
  });
  lines.push("  0. Back");
  return lines.join("\n");
}

async function promptFor(question, options = {}) {
  const { input } = promptStreams(options);
  if (!input.isTTY) return "";
  if (isInteractive(input)) {
    let value = options.defaultValue != null && !options.password ? String(options.defaultValue) : "";
    let cursor = value.length;
    const answer = await runRawPrompt(
      () => terminalTextFrame(question, value, cursor, options),
      (key) => {
        if (key.name === "enter") return { type: "submit", value };
        if (key.name === "backspace" && cursor > 0) {
          value = `${value.slice(0, cursor - 1)}${value.slice(cursor)}`;
          cursor -= 1;
        } else if (key.name === "delete" && cursor < value.length) {
          value = `${value.slice(0, cursor)}${value.slice(cursor + 1)}`;
        } else if (key.name === "left") {
          cursor = Math.max(0, cursor - 1);
        } else if (key.name === "right") {
          cursor = Math.min(value.length, cursor + 1);
        } else if (key.name === "home") {
          cursor = 0;
        } else if (key.name === "end") {
          cursor = value.length;
        } else if (key.name === "char" || key.name === "space") {
          value = `${value.slice(0, cursor)}${key.char}${value.slice(cursor)}`;
          cursor += key.char.length;
        }
        return null;
      },
      options,
    );
    const normalized = options.trim === false ? String(answer ?? "") : String(answer ?? "").trim();
    if (normalized === "" && options.defaultValue != null) return String(options.defaultValue);
    return normalized;
  }
  const context = beginPrompt(options);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question, context.signal ? { signal: context.signal } : undefined);
    context.interrupt?.throwIfExitRequested();
    const value = options.trim === false ? answer : answer.trim();
    if (value === "" && options.defaultValue != null) return String(options.defaultValue);
    return value;
  } catch (error) {
    if (error?.name === "AbortError") throwPromptCancel(context.interrupt);
    throw error;
  } finally {
    rl.close();
    endPrompt(context);
  }
}

async function confirm(question, defaultValue = false, options = {}) {
  const { input } = promptStreams(options);
  if (isInteractive(input)) {
    let value = defaultValue === true;
    return runRawPrompt(
      () => terminalConfirmFrame(question, value, defaultValue, options),
      (key) => {
        if (key.name === "enter") return { type: "submit", value };
        if (key.name === "left" || key.name === "right" || key.name === "space") value = !value;
        if (key.name === "char" && key.char.toLowerCase() === "y") return { type: "submit", value: true };
        if (key.name === "char" && key.char.toLowerCase() === "n") return { type: "submit", value: false };
        return null;
      },
      options,
    );
  }
  const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
  const answer = (await promptFor(`${question}${suffix}`)).toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes";
}

async function select(title, options, promptOptions = {}) {
  const { input } = promptStreams(promptOptions);
  if (!input.isTTY) return null;
  if (isInteractive(input)) {
    if (options.length === 0) return null;
    let cursor = Math.max(0, Math.min(promptOptions.initialIndex || 0, options.length - 1));
    return runRawPrompt(
      () => terminalSelectFrame(title, options, cursor, promptOptions),
      (key) => {
        if (key.name === "enter") return { type: "submit", value: options[cursor] };
        if (key.name === "up") cursor = cursor <= 0 ? options.length - 1 : cursor - 1;
        if (key.name === "down") cursor = cursor >= options.length - 1 ? 0 : cursor + 1;
        if (key.name === "home") cursor = 0;
        if (key.name === "end") cursor = options.length - 1;
        return null;
      },
      promptOptions,
    );
  }
  console.log(formatFallbackMenu(title, options));
  while (true) {
    const answer = await promptFor("Choose: ");
    const picked = Number(answer);
    if (picked === 0) return null;
    if (Number.isInteger(picked) && picked >= 1 && picked <= options.length) {
      return options[picked - 1];
    }
    console.log("Please choose a number from the menu.");
  }
}

async function multiSelect(title, options, selected = [], promptOptions = {}) {
  const { input } = promptStreams(promptOptions);
  if (!input.isTTY || options.length === 0) return [];
  if (isInteractive(input)) {
    let cursor = Math.max(0, Math.min(promptOptions.initialIndex || 0, options.length - 1));
    const selectedValues = new Set(selected);
    return runRawPrompt(
      () => terminalMultiSelectFrame(title, options, cursor, selectedValues, promptOptions),
      (key) => {
        if (key.name === "enter") {
          return {
            type: "submit",
            value: options.filter((option) => selectedValues.has(option.value)).map((option) => option.value),
          };
        }
        if (key.name === "up") cursor = cursor <= 0 ? options.length - 1 : cursor - 1;
        if (key.name === "down") cursor = cursor >= options.length - 1 ? 0 : cursor + 1;
        if (key.name === "home") cursor = 0;
        if (key.name === "end") cursor = options.length - 1;
        if (key.name === "space") {
          const value = options[cursor].value;
          if (selectedValues.has(value)) selectedValues.delete(value);
          else selectedValues.add(value);
        }
        return null;
      },
      promptOptions,
    );
  }
  console.log(`\n${title}`);
  options.forEach((option, index) => {
    const detail = option.detail ? ` - ${option.detail}` : "";
    console.log(`  ${index + 1}. ${option.label}${detail}`);
  });
  const answer = await promptFor("Choose one or more numbers, separated by commas: ");
  if (!answer.trim()) return [];
  return answer
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= options.length)
    .map((value) => options[value - 1].value);
}

async function note(body, title = "Team OS") {
  if (isInteractive()) {
    const p = await clack();
    p.note(body, title);
    return;
  }
  console.log(`\n${title}\n${body}`);
}

async function intro(message) {
  if (isInteractive()) {
    const p = await clack();
    p.intro(message);
    return;
  }
  console.log(message);
}

async function outro(message) {
  if (isInteractive()) {
    const p = await clack();
    p.outro(message);
    return;
  }
  console.log(message);
}

async function withSpinner(message, fn, options = {}) {
  const interrupt = activeInterrupt(options);
  interrupt?.throwIfExitRequested();
  if (!isInteractive()) {
    const result = await fn();
    interrupt?.throwIfExitRequested();
    return result;
  }
  const p = await clack();
  const spinner = p.spinner();
  spinner.start(message);
  try {
    const result = await fn();
    interrupt?.throwIfExitRequested();
    spinner.stop("Done");
    return result;
  } catch (error) {
    spinner.stop(isPromptExit(error) ? "Stopped" : "Stopped");
    throw error;
  }
}

module.exports = {
  PromptBackError,
  PromptExitError,
  confirm,
  createPromptInterrupt,
  formatFallbackMenu,
  intro,
  isInteractive,
  isPromptAvailable,
  isPromptBack,
  isPromptCancel,
  isPromptExit,
  multiSelect,
  note,
  outro,
  promptFor,
  select,
  setPromptInterrupt,
  withSpinner,
};
