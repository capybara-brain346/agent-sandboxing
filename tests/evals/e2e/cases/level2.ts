import path from "node:path";
import { replaceFixtureText } from "../harness/fixture";
import type { CapyNodesEvalCase } from "../harness/types";

const level2: CapyNodesEvalCase = {
  id: "level-2-custom-node-ownership",
  level: 2,
  title: "Custom node ownership is enforced by the API",
  prompt:
    "Harden the custom-node API. A signed-in user must only list and mutate their own custom node definitions, creation must always assign the authenticated owner, and request data must not be able to choose or expose the user field. Preserve the existing endpoint shape, add regression coverage for cross-user list/detail/update/delete isolation and forged-owner creation, and do not touch migrations or settings.",
  seed: async (root) => {
    await replaceFixtureText(
      root,
      "api/views/nodes.py",
      "        return CustomNodeDefinition.objects.filter(user=self.request.user)",
      "        return CustomNodeDefinition.objects.all()",
    );
    await replaceFixtureText(
      root,
      "api/views/nodes.py",
      "        serializer.save(user=self.request.user)",
      "        serializer.save()",
    );
    await replaceFixtureText(
      root,
      "api/serializers/__init__.py",
      '        fields = [\n            "id",\n            "type",\n            "label",\n            "category",\n            "icon_name",\n            "description",\n            "tooltip",\n            "properties",\n            "inputs",\n            "outputs",\n            "created_at",\n            "updated_at",\n        ]\n        read_only_fields = ["id", "created_at", "updated_at"]',
      '        fields = "__all__"\n        read_only_fields = ["id", "created_at", "updated_at"]',
    );
  },
  oracleDirectory: path.resolve("tests/evals/e2e/oracles/level2/e2e_hidden"),
  grading: [
    {
      name: "level 2 hidden custom node API tests",
      command:
        "DATABASE_URL='' DJANGO_SETTINGS_MODULE=capynodes_backend.settings uv run --project /opt/capynodes-backend --frozen --offline python manage.py test e2e_hidden.test_custom_nodes",
    },
  ],
  protectedPaths: [
    "api/migrations",
    "capynodes_backend/settings.py",
    "capynodes-frontend",
    "pyproject.toml",
    "uv.lock",
  ],
  requiredPaths: ["api/views/nodes.py", "api/serializers/__init__.py"],
};

export default level2;
