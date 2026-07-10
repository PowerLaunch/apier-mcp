#!/usr/bin/env bash
set -euo pipefail

# Usage: check-pr-reviews.sh <PR_NUMBER>
#
# Prints one of CLEAN / PENDING / FAILING and exits with a matching code:
#   CLEAN   (exit 0) - every status check completed with a passing conclusion
#                       and no reviewer has requested changes
#   PENDING (exit 1) - one or more checks are still queued/running, or there
#                       are no checks reported yet
#   FAILING (exit 2) - a check completed without passing, or a reviewer
#                       requested changes

PR="${1:?usage: check-pr-reviews.sh <PR_NUMBER>}"

data=$(gh pr view "$PR" --json statusCheckRollup,reviewDecision)

review_decision=$(jq -r '.reviewDecision // empty' <<<"$data")

if [[ "$review_decision" == "CHANGES_REQUESTED" ]]; then
  echo "FAILING: changes requested by a reviewer"
  exit 2
fi

# Normalize both possible statusCheckRollup shapes (CheckRun vs legacy StatusContext)
# into {name, completed, passing} so the rest of the script doesn't care which API
# reported the check.
check_status=$(jq -c '
  [.statusCheckRollup[]? |
    if .__typename == "CheckRun" then
      { name: .name,
        completed: (.status == "COMPLETED"),
        passing: (.status == "COMPLETED" and (.conclusion == "SUCCESS" or .conclusion == "NEUTRAL" or .conclusion == "SKIPPED")) }
    else
      { name: .context,
        completed: (.state != "PENDING" and .state != "EXPECTED"),
        passing: (.state == "SUCCESS") }
    end
  ]' <<<"$data")

total=$(jq 'length' <<<"$check_status")
pending=$(jq '[.[] | select(.completed == false)] | length' <<<"$check_status")
failed=$(jq -c '[.[] | select(.completed == true and .passing == false) | .name]' <<<"$check_status")
failed_count=$(jq 'length' <<<"$failed")

if [[ "$failed_count" -gt 0 ]]; then
  echo "FAILING: checks not passing -> $(jq -r 'join(", ")' <<<"$failed")"
  exit 2
fi

if [[ "$total" -eq 0 || "$pending" -gt 0 ]]; then
  echo "PENDING: $pending/$total checks still running, reviewDecision=${review_decision:-none}"
  exit 1
fi

echo "CLEAN: all $total checks passing, reviewDecision=${review_decision:-none}"
exit 0
