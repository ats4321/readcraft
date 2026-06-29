Output scripts/demo-before-after.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 800
Set Margin 24
Set Padding 16
Set Theme "Dracula"
Set TypingSpeed 45ms

Type "ROOT_DIR=$(pwd)"
Enter
Sleep 300ms

Type "npm run build"
Enter
Sleep 2s

Type "DEMO_DIR=$(mktemp -d)"
Enter
Sleep 200ms

Type "cp -R \"$ROOT_DIR/tests/fixtures/node-express/.\" \"$DEMO_DIR\""
Enter
Sleep 300ms

Type "rm -f \"$DEMO_DIR/README.md\""
Enter
Sleep 300ms

Type "cd \"$DEMO_DIR\""
Enter
Sleep 300ms

Type "echo \"=== BEFORE ===\" && ls -1"
Enter
Sleep 1200ms

Type "node \"$ROOT_DIR/dist/index.js\" --yes"
Enter
Sleep 8s

Type "echo \"=== AFTER ===\" && ls -1"
Enter
Sleep 1200ms

Type "sed -n '1,30p' README.md"
Enter
Sleep 2s

Type "rm -rf \"$DEMO_DIR\""
Enter
Sleep 400ms
