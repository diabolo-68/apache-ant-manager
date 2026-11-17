# Writes its arguments to python.out in the current directory (checked by the tests).
import sys

message = "Report for " + " ".join(sys.argv[1:] or ["all"])
print(message)
with open("python.out", "w") as out:
    out.write(message + "\n")
