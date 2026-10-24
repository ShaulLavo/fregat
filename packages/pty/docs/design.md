# Design

## A callback at spawn, a promise at exit

`spawnPty` takes the output callback at spawn time and returns an exit promise. Callers cannot miss startup output, and they await cleanup without managing subscriptions. Fregat's terminal host uses that interface directly and keeps bytes in its own replay buffer.

## One owner for process and terminal

One owner coordinates the subprocess and pty lifetimes. Linux probes produced `HEAD`, direct child exit, `TAIL`, then pty EOF, so closing on subprocess exit would truncate output. Inline terminal options let Bun release the parent's slave descriptor. A separately constructed `Bun.Terminal` keeps it and cannot give the same natural EOF barrier.

## Output reads cannot pause

Bun has no public method to pause output reads. A stream would add a queue without controlling native backpressure, so the callback API exposes that limit directly. UTF-8 decoding, replay, WebSocket framing, settings and session logs stay with the consumer.
