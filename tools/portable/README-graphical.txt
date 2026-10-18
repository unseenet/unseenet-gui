UNSEENET - THE GRAPHICAL CLIENT, PORTABLE
===================================

Unseenet in a window of its own: groups as threads, chats as chats. Tor is
included. Nothing is installed and nothing is left on the computer: your
vault, the offline cache and Tor's state are in data/ beside the programs.

Start it:
  Windows:  Unseenet Graphical.exe           (WebView2, part of Windows 10 and 11)
  macOS:    Start Unseenet Graphical.command
  Linux:    sh start-graphical-linux.sh      (opens in Chromium/Chrome/Edge/Brave
                                        without tabs if you have one, else
                                        in your browser)

It uses the same data/ as the terminal client (Start Unseenet.bat and the
others), so if both are on this stick you are the same person in both. Do not
run both at the same time.

The window talks only to a small server on this computer (127.0.0.1), which
talks to the network only through Tor. Your keys never leave that server.

Pre-alpha: the code has not had a security review. Do not rely on it to
protect anyone yet.

https://github.com/unseenet/unseenet-gui  ·  https://unseenet.org
