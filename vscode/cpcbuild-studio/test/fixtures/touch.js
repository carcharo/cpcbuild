// The test "emulator": creates the file named by its argument (portable stand-in for `touch`).
require('fs').writeFileSync(process.argv[2], '');
