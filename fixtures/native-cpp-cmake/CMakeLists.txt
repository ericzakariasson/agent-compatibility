cmake_minimum_required(VERSION 3.24)
project(native_cpp_cmake LANGUAGES CXX)

add_library(native_cpp_cmake src/lib.cpp)

include(CTest)
if(BUILD_TESTING)
  add_executable(example_test tests/example_test.cpp)
  add_test(NAME example COMMAND example_test)
endif()
