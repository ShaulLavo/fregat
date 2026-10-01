# design

## a callback at spawn, a promise at exit

`spawnPty` takes the output callback at spawn time and returns an exit promise. callers cannot miss startup output, and they await cleanup without managing subscriptions. fregat's terminal host uses that interface directly and keeps bytes in its own replay buffer

## one owner for process and terminal

one owner coordinates the subprocess and pty lifetimes. linux probes produced `HEAD`, direct child exit, `TAIL`, then pty eof, so closing on subprocess exit would truncate output. inline terminal options let bun release the parent's slave descriptor. a separately constructed `Bun.Terminal` keeps it and cannot give the same natural eof barrier

## output reads cannot pause

bun has no public method to pause output reads. a stream would add a queue without controlling native backpressure, so the callback api exposes that limit directly. utf-8 decoding, replay, websocket framing, settings and session logs stay with the consumer
