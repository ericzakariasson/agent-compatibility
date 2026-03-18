build:
	cc -c src/lib.c -o build/lib.o

test:
	cc tests/lib_test.c src/lib.c -o build/lib_test && ./build/lib_test

check:
	clang-tidy src/lib.c --

fmt:
	clang-format -i src/lib.c tests/lib_test.c
