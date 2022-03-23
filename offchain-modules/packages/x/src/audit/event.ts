export class EventManager {
  events: Map<string, Listener[]>;

  attach(events: string[], listener: Listener): void {
    for (const event in events) {
      let listeners = this.events.get(event);
      if (listeners === undefined) {
        listeners = [];
      }

      listeners.push(listener);

      this.events.set(event, listeners);
    }
  }

  dettach(events: string[], listener: Listener): void {
    for (const event in events) {
      const listeners = this.events.get(event);
      if (listeners === undefined) {
        continue;
      }

      const index = listeners.findIndex((v) => {
        if (typeof v == typeof listener) {
          return true;
        }
      });

      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
  notify(event: string, ...args: any): void {
    const listeners = this.events.get(event);

    if (listeners === undefined) {
      return;
    }

    for (const listener of listeners) {
      listener.update(args);
    }
  }
}

export interface Listener {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update(...args: any);
}
