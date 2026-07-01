import checkbox from "@inquirer/checkbox";
import confirm from "@inquirer/confirm";
import select from "@inquirer/select";

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

/**
 * Production implementation using Inquirer prompt packages.
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
