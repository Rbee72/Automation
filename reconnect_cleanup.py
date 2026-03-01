import json

with open("eBook Ingestion.json", "r") as f:
    data = json.load(f)

# 1. Update Execute Command6 (Cleanup) - Re-enable logic
for node in data["nodes"]:
    if node["name"] == "Execute Command6":
        node["parameters"]["command"] = """=# 1. Variables
TARGET_DIR="{{ JSON.parse($node[\"Execute Command1\"].json.stdout).targetDir }}"

# 2. Cleanup
if [ -d "$TARGET_DIR" ]; then
  # Delete only the PDF sitting in the root (not inside chapters)
  find "$TARGET_DIR" -maxdepth 1 \\( -name "*.pdf" -o -name "*.PDF" \\) -delete
fi

echo "{\\"status\\": \\"complete\\", \\"msg\\": \\"Root cleaned for $TARGET_DIR\\"}" """
        node["executeOnce"] = True

# 2. Update Merge node - Ensure v1 'wait' mode for stability
for node in data["nodes"]:
    if node["name"] == "Merge":
        node["typeVersion"] = 1
        node["parameters"] = {
            "mode": "wait"
        }

# 3. Re-build connections to include Merge and Cleanup
# Trigger -> Setup
# Setup -> Thumbs
# Setup -> Merge (Index 0)
# Thumbs -> Sheets
# Sheets -> Classify
# Classify -> Merge (Index 1)
# Merge -> Cleanup

conns = data["connections"]

# Ensure Setup -> Merge (0) exists
setup_targets = conns.get("Execute Command1", {}).get("main", [[]])[0]
if not any(t["node"] == "Merge" and t["index"] == 0 for t in setup_targets):
    setup_targets.append({"node": "Merge", "type": "main", "index": 0})

# Ensure Classify -> Merge (1) exists
classify_targets = conns.get("Execute Command3", {}).get("main", [[]])[0]
# Replace existing targets for Classify to point to Merge
conns["Execute Command3"] = {"main": [[{"node": "Merge", "type": "main", "index": 1}]]}

# Ensure Merge -> Cleanup exists
conns["Merge"] = {"main": [[{"node": "Execute Command6", "type": "main", "index": 0}]]}

with open("eBook Ingestion.json", "w") as f:
    json.dump(data, f, indent=2)

print("Workflow RECONNECTED: Merge and Cleanup are back with safe sync logic.")
