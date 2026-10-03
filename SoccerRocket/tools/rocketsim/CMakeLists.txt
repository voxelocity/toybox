cmake_minimum_required(VERSION 3.16)
project(rs_oracle CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
# -O2 (no -ffast-math): keep IEEE float behaviour identical to upstream builds.
set(CMAKE_CXX_FLAGS_RELEASE "-O2 -DNDEBUG")

if(NOT RS_DIR)
  message(FATAL_ERROR "Pass -DRS_DIR=<path to a RocketSim checkout>")
endif()

# RocketSim's own CMakeLists builds the static library "RocketSim"
# (RocketSim sources + its modified Bullet 3.24).
add_subdirectory(${RS_DIR} rocketsim EXCLUDE_FROM_ALL)
target_compile_options(RocketSim PRIVATE -w)

add_executable(rs_oracle rs_oracle.cpp)
target_include_directories(rs_oracle PRIVATE ${RS_DIR}/src)
target_link_libraries(rs_oracle PRIVATE RocketSim)
