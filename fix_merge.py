import json

with open("eBook Ingestion.json", "r") as f:
    data = json.load(f)

for node in data["nodes"]:
    if node["name"] == "Merge":
        # Change mode to "append" which doesn't require field matching
        # and serves as a simple wait/join point.
        node["parameters"]["mode"] = "append"
        # Removing combine-specific options if any, though version 3.2 uses mode
        if "combinationMode" in node["parameters"]:
            del node["parameters"]["combinationMode"]

with open("eBook Ingestion.json", "w") as f:
    json.dump(data, f, indent=2)

print("Updated eBook Ingestion.json: Changed Merge node mode to 'append'")
