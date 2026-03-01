import json

with open("eBook Ingestion.json", "r") as f:
    data = json.load(f)

# 1. Clear pinData and meta completely to prevent internal errors
data["pinData"] = {}
if "meta" in data:
    data["meta"] = {"templateCredsSetupCompleted": True}
data["versionId"] = ""

# 2. Re-create the nodes with stable versions (v1 for Merge)
new_nodes = []
manual_trigger = None
setup_node = None
thumbs_node = None
sheets_node = None
classify_node = None
merge_node = None
cleanup_node = None

# Preserve Sticky Notes
sticky_notes = [n for n in data["nodes"] if "stickyNote" in n["type"]]
new_nodes.extend(sticky_notes)

# Rebuild Core Nodes
for node in data["nodes"]:
    if "manualTrigger" in node["type"]:
        manual_trigger = node
        manual_trigger["name"] = "When clicking \u201cExecute workflow\u201d" # Simplified
        new_nodes.append(manual_trigger)
    elif node["name"] == "Execute Command1":
        setup_node = node
        new_nodes.append(setup_node)
    elif node["name"] == "Extract Thumbnails":
        thumbs_node = node
        new_nodes.append(thumbs_node)
    elif node["name"] == "Get row(s) in sheet":
        sheets_node = node
        sheets_node["parameters"]["options"] = {"returnAll": True}
        new_nodes.append(sheets_node)
    elif node["name"] == "Execute Command3":
        classify_node = node
        new_nodes.append(classify_node)
    elif node["name"] == "Execute Command6":
        cleanup_node = node
        cleanup_node["executeOnce"] = True
        new_nodes.append(cleanup_node)
    elif node["name"] == "Merge":
        merge_node = node
        # USE VERSION 1 for stability
        merge_node["typeVersion"] = 1
        merge_node["parameters"] = {
            "mode": "wait"
        }
        new_nodes.append(merge_node)

data["nodes"] = new_nodes

# 3. Re-build connections with exact names
new_conns = {}

def add_conn(src, target, target_index=0):
    if src not in new_conns:
        new_conns[src] = {"main": [[]]}
    new_conns[src]["main"][0].append({"node": target, "type": "main", "index": target_index})

if manual_trigger and setup_node:
    add_conn(manual_trigger["name"], setup_node["name"])

if setup_node and thumbs_node and merge_node:
    add_conn(setup_node["name"], thumbs_node["name"])
    add_conn(setup_node["name"], merge_node["name"], 0)

if thumbs_node and sheets_node:
    add_conn(thumbs_node["name"], sheets_node["name"])

if sheets_node and classify_node:
    add_conn(sheets_node["name"], classify_node["name"])

if classify_node and merge_node:
    add_conn(classify_node["name"], merge_node["name"], 1)

if merge_node and cleanup_node:
    add_conn(merge_node["name"], cleanup_node["name"])

data["connections"] = new_conns

with open("eBook Ingestion.json", "w") as f:
    json.dump(data, f, indent=2)

print("Final Repair: Schema aligned (Merge v1) and connections rebuilt.")
