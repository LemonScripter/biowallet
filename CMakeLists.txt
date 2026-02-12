cmake_minimum_required(VERSION 3.10)
project(MetaSpaceCore)

set(CMAKE_CXX_STANDARD 17)

# Find Z3 (Assumes Z3 is installed and in path/standard location)
find_path(Z3_INCLUDE_DIR NAMES z3++.h)
find_library(Z3_LIBRARY NAMES z3)

include_directories(${Z3_INCLUDE_DIR})

add_library(metaspace_core STATIC 
    src/core/metaspace_core.cpp
)

target_link_libraries(metaspace_core ${Z3_LIBRARY})

# Example test app
add_executable(metaspace_test src/core/main_test.cpp)
target_link_libraries(metaspace_test metaspace_core ${Z3_LIBRARY})
