FROM ubuntu:24.04

ARG RUNNER_VERSION
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git jq libicu74 openssh-client tar \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 1001 --shell /bin/bash runner

RUN test -n "$RUNNER_VERSION" \
  && mkdir -p /home/runner/actions-runner \
  && curl --fail --show-error --silent --location \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
    | tar -xz -C /home/runner/actions-runner \
  && /home/runner/actions-runner/bin/installdependencies.sh \
  && chown -R runner:runner /home/runner

USER runner
WORKDIR /home/runner/actions-runner
ENTRYPOINT ["/bin/sleep", "infinity"]
