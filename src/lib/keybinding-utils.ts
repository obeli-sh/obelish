export interface KeyBinding {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

export function isMac(): boolean {
  return navigator.platform.includes('Mac');
}

export function bindingToString(binding: KeyBinding): string {
  const parts: string[] = [];

  if (binding.mod) {
    parts.push(isMac() ? 'Cmd' : 'Ctrl');
  }
  if (binding.shift) {
    parts.push('Shift');
  }
  if (binding.alt) {
    parts.push('Alt');
  }

  const keyDisplay = binding.key.length === 1 ? binding.key.toUpperCase() : binding.key;
  parts.push(keyDisplay);

  return parts.join('+');
}

export function bindingsEqual(a: KeyBinding, b: KeyBinding): boolean {
  return (
    a.key.toLowerCase() === b.key.toLowerCase() &&
    a.mod === b.mod &&
    a.shift === b.shift &&
    a.alt === b.alt
  );
}

function bindingKey(b: KeyBinding): string {
  return `${b.key.toLowerCase()}|${b.mod}|${b.shift}|${b.alt}`;
}

export function detectConflicts(
  bindings: Record<string, KeyBinding>,
): { commands: string[]; binding: KeyBinding }[] {
  const groups = new Map<string, { commands: string[]; binding: KeyBinding }>();

  for (const [commandId, binding] of Object.entries(bindings)) {
    const key = bindingKey(binding);
    const existing = groups.get(key);
    if (existing) {
      existing.commands.push(commandId);
    } else {
      groups.set(key, { commands: [commandId], binding });
    }
  }

  return Array.from(groups.values()).filter((g) => g.commands.length > 1);
}
