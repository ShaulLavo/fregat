# State ownership

[AGENTS.md](../AGENTS.md#react) is the current coding rule. State that outlives a component uses
zustand; non-React owners expose their vanilla store, and React selects what it reads. Selectors
return primitives, held references or values stabilized by the appropriate selector mechanism.
DOM events, live sockets and mutable objects that publish a revision retain their external-store
subscriptions.

React effects do not populate module slots for values already owned by stores, the editor
runtime, settings or navigation. Read those values from their owner. A binding remains appropriate
for a DOM node, live socket or genuinely component-owned held state.

## Delivery references

- [Direct owner bindings](https://github.com/ShaulLavo/fregat/blob/8ca59fd7df915cccae0f3b920b8746c7a7651956/plans/193-no-late-bound-slots.md)
  records navigation boot binding, editor lifetime, settings dispatch and the retained exceptions.
- [Store consolidation](https://github.com/ShaulLavo/fregat/blob/8ca59fd7df915cccae0f3b920b8746c7a7651956/plans/199-one-store-library.md)
  records web/TUI migrations, selector tests and deliberate exceptions. The proposed census gate
  was dropped; the rule is in AGENTS.md.

These plans are completed and retired. Their original tests, measurements and tradeoffs remain
in the linked revision; later changes should be evaluated against the current owners and tests.
