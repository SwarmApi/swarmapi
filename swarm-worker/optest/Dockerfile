FROM ubuntu:24.04

# Avoid host proxy injection in build environment
ENV http_proxy="" https_proxy="" HTTP_PROXY="" HTTPS_PROXY="" no_proxy="" NO_PROXY=""

# Use Aliyun mirror for better reliability
RUN sed -i 's|http://archive.ubuntu.com|http://mirrors.aliyun.com|g' /etc/apt/sources.list.d/*.sources 2>/dev/null || true

# Install dependencies for the opencode install script with retries
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates bash jq \
    || (sleep 5 && apt-get update && apt-get install -y --no-install-recommends --fix-missing curl ca-certificates bash jq) \
    && rm -rf /var/lib/apt/lists/*

# Install OpenCode AI cli via provided script
RUN curl -fsSL https://opencode.ai/install | bash

# Source bashrc to make opencode available and verify installation
RUN bash -c 'source /root/.bashrc && command -v opencode' || (find /root -name "opencode" -type f 2>/dev/null | head -1)

WORKDIR /work

# default command to show opencode version and keep container running
CMD ["bash", "-ic", "opencode --version && sleep infinity"]
