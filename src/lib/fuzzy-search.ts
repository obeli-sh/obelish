import Fuse, { type IFuseOptions } from 'fuse.js';
import type { Command } from './commands';

const fuseOptions: IFuseOptions<Command> = {
  keys: [
    { name: 'label', weight: 2 },
    { name: 'description', weight: 1 },
    { name: 'category', weight: 0.5 },
  ],
  threshold: 0.4,
  includeScore: true,
};

export function fuzzySearchCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) {
    return commands;
  }

  const fuse = new Fuse(commands, fuseOptions);
  return fuse.search(query).map((result) => result.item);
}
