import argparse
import struct
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("executable", type=Path)
    executable = parser.parse_args().executable
    data = executable.read_bytes()
    if data[:2] != b"MZ":
        raise ValueError("Expected a Windows executable")
    offset = struct.unpack_from("<I", data, 0x3C)[0]
    if data[offset:offset + 4] != b"PE\0\0":
        raise ValueError("Missing PE header")
    subsystem = struct.unpack_from("<H", data, offset + 24 + 68)[0]
    if subsystem != 2:
        raise ValueError(f"Expected Windows GUI subsystem (2), found {subsystem}")
    print(f"{executable.name}: Windows GUI subsystem verified (no automatic console)")


if __name__ == "__main__":
    main()
