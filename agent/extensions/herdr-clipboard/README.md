# Herdr clipboard relay

Pi normally detects remote clipboard targets from SSH or Mosh environment
variables. A Pi process hosted by Herdr's persistent server does not inherit the
transport of whichever client is currently attached.

This extension mirrors Pi's successful native text clipboard writes as OSC 52
when `HERDR_ENV` is present. Herdr forwards the request only to its foreground
client; that client then chooses its native clipboard for a local attachment or
OSC 52 for an SSH/Mosh attachment.

The extension does not change copy keybindings. In fullscreen mode, selection
copies automatically by default. With `fullscreenCopyOnSelect` disabled,
`Ctrl+X` copies the active selection.
