import { checkbox, select } from "@inquirer/prompts";

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
 * Wraps @inquirer/prompts for dependency injection and testability.
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

  /** Three-way confirmation: yes / no / always */
  confirm3(message: string): Promise<ConfirmChoice>;
}

/**
 * Production implementation using @inquirer/prompts.
 */
export class PromptServiceImpl implements PromptService {
  async select<T>(
    message: string,
    choices: SelectChoice<T>[],
    defaultValue?: T,
  ): Promise<T> {
    return select({ message, choices, default: defaultValue });
  }

  async checkbox<T>(
    message: string,
    choices: CheckboxChoice<T>[],
  ): Promise<T[]> {
    return checkbox({ message, choices });
  }

  async confirm3(message: string): Promise<ConfirmChoice> {
    return select({
      message,
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
