# Enable the -n option (no execution)
set -n

# Redirect stderr (file descriptor 2) to stdout (file descriptor 1)
exec 2>&1

# Exit the shell
exit


