import { vi } from 'vitest';

export const Group = vi.fn(({ children, ...props }: any) => (
  <div data-testid="panel-group" data-orientation={props.orientation}>{children}</div>
));

export const Panel = vi.fn(({ children, ...props }: any) => (
  <div data-testid="panel" data-default-size={props.defaultSize}>{children}</div>
));

export const Separator = vi.fn(({ style, ...props }: any) => (
  <div data-testid="panel-resize-handle" style={style} {...props} />
));
