# State ownership

[React development](../.agents/skills/react-development/SKILL.md#react) holds the current coding rule. State that outlives a component uses
zustand; non-React owners expose their vanilla store, and React selects what it reads. Selectors
return primitives, held references or values stabilized by the appropriate selector mechanism.
DOM events, live sockets and mutable objects that publish a revision retain their external-store
subscriptions.

React effects do not populate module slots for values already owned by stores, the editor
runtime, settings or navigation. Read those values from their owner. A binding remains appropriate
for a DOM node, live socket or genuinely component-owned held state.
