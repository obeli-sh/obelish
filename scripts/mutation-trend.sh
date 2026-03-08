#!/bin/bash
# mutation-trend.sh — Extract and display mutation testing trend
set -e

MUTANTS_DIR="${1:-mutants.out}"

if [ ! -d "$MUTANTS_DIR" ]; then
    echo "No mutants output directory found at $MUTANTS_DIR"
    exit 0
fi

caught=0
missed=0
timeout=0

if [ -f "$MUTANTS_DIR/caught.txt" ]; then
    caught=$(wc -l < "$MUTANTS_DIR/caught.txt")
fi

if [ -f "$MUTANTS_DIR/missed.txt" ]; then
    missed=$(wc -l < "$MUTANTS_DIR/missed.txt")
fi

if [ -f "$MUTANTS_DIR/timeout.txt" ]; then
    timeout=$(wc -l < "$MUTANTS_DIR/timeout.txt")
fi

total=$((caught + missed))
if [ $total -eq 0 ]; then
    echo "No mutants found."
    exit 0
fi

score=$((caught * 100 / total))

echo "=== Mutation Testing Results ==="
echo "Caught:  $caught"
echo "Missed:  $missed"
echo "Timeout: $timeout"
echo "Total:   $total"
echo "Score:   ${score}%"
echo "==============================="

if [ $score -lt 70 ]; then
    echo "WARNING: Mutation score is below 70%"
    exit 1
fi
