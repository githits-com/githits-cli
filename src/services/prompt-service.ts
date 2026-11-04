import checkbox from "@inquirer/checkbox";
import confirm from "@inquirer/confirm";
import select from "@inquirer/select";
import stringWidth from "fast-string-width";

/** Choice for checkbox prompt */
export interface CheckboxChoice<T> {
  /** Display name */
  name: string;
  /** Value returned when selected */
  value: T;
  /** Whether pre-selected */
  checked?: boolean;
  /** Optional description shown below the choice */
  description?: string;
  /** Whether the choice is disabled */
  disabled?: boolean | string;
}

/** Choice for select prompt */
export interface SelectChoice<T> {
  /** Display name */
  name: string;
  /** Value returned when selected */
  value: T;
  /** Optional description shown below the choice */
  description?: string;
}

/** User's confirmation choice for sequential setup */
export type ConfirmChoice = "yes" | "no" | "always";

/**
 * Service interface for interactive terminal prompts.
 * Wraps Inquirer prompt packages for dependency injection and testability.
 */
export interface PromptService {
  /** Single-select prompt */
  select<T>(
    message: string,
    choices: SelectChoice<T>[],
    defaultValue?: T,
  ): Promise<T>;

  /** Multi-select with pre-checked items */
  checkbox<T>(message: string, choices: CheckboxChoice<T>[]): Promise<T[]>;

  /** Simple yes/no confirmation for one-off actions. */
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;

  /** Three-way confirmation: yes / no / always */
  confirm3(
    message: string,
    defaultValue?: ConfirmChoice,
  ): Promise<ConfirmChoice>;
}

/** Wrap plain prompt text at word boundaries, preserving authored line breaks. */
export function wrapPromptText(text: string, width: number): string {
  return text
    .split("\n")
    .map((paragraph) => {
      const indent = paragraph.match(/^ */)?.[0] ?? "";
      const words = paragraph.trim().split(/\s+/);
      const lines: string[] = [];
      let line = indent;
      for (const word of words) {
        const candidate = line.trim() ? `${line} ${word}` : `${indent}${word}`;
        if (line.trim() && stringWidth(candidate) > width) {
          lines.push(line);
          line = `${indent}${word}`;
        } else line = candidate;
      }
      return [...lines, line].join("\n");
    })
    .join("\n");
}

/** Reserve Inquirer's prefix columns when preparing selectable labels. */
function wrapChoices<T extends { name: string; description?: string }>(
  choices: T[],
): T[] {
  const columns = process.stdout.columns || 80;
  return choices.map((choice) => ({
    ...choice,
    name: wrapPromptText(choice.name, columns - 2).replaceAll("\n", "\n  "),
    short: choice.name,
    ...(choice.description === undefined
      ? {}
      : {
          description: wrapPromptText(choice.description, columns - 1),
        }),
  }));
}

/**
 * Production implementation using Inquirer prompt packages.
 */
export class PromptServiceImpl implements PromptService {
  async select<T>(
    message: string,
    choices: SelectChoice<T>[],
    defaultValue?: T,
  ): Promise<T> {
    return select({
      message: wrapPromptText(message, (process.stdout.columns || 80) - 2),
      choices: wrapChoices(choices),
      default: defaultValue,
    });
  }

  async checkbox<T>(
    message: string,
    choices: CheckboxChoice<T>[],
  ): Promise<T[]> {
    return checkbox({
      message: wrapPromptText(message, (process.stdout.columns || 80) - 2),
      choices: wrapChoices(choices),
    });
  }

  async confirm(message: string, defaultValue?: boolean): Promise<boolean> {
    return confirm({ message, default: defaultValue });
  }

  async confirm3(
    message: string,
    defaultValue?: ConfirmChoice,
  ): Promise<ConfirmChoice> {
    return select({
      message,
      default: defaultValue,
      choices: [
        { value: "yes" as ConfirmChoice, name: "Yes" },
        { value: "no" as ConfirmChoice, name: "No" },
        {
          value: "always" as ConfirmChoice,
          name: "Yes to all",
          description: "Skip confirmation for remaining agents",
        },
      ],
    });
  }
}
