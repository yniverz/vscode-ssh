<template>
  <div id='app'>
    <h1>{{title}}</h1>
    <blockquote class="panel" id="error" v-if="error">
      <p class="panel__text">
        Connection error! <span id="errorMessage" v-text="errorMessage"></span><br />
      </p>
    </blockquote>
    <el-table :data="forwardList" style="width: 100%">
      <el-table-column prop="name" label="name">
      </el-table-column>
      <el-table-column prop="localHost" label="Local Host">
      </el-table-column>
      <el-table-column prop="localPort" label="Local Port">
      </el-table-column>
      <el-table-column prop="remoteHost" label="Remote Host">
      </el-table-column>
      <el-table-column prop="remotePort" label="Remote Port">
      </el-table-column>
      <el-table-column prop="state" label="State">
        <template slot-scope="scope">
          {{scope.row.state==true?"running":"stop"}}
        </template>
      </el-table-column>
      <el-table-column fixed="right" width="200">
        <template slot="header" slot-scope="scope">
          <el-button type="info" icon="el-icon-circle-plus-outline" size="small" circle @click="createRequest"> </el-button>
          <el-button type="primary" icon="el-icon-refresh" size="small" circle @click="load"> </el-button>
        </template>
        <template slot-scope="scope">
          <el-button v-if="!scope.row.state" @click="start(scope.row.id);" type="success" size="small" title="Start" icon="el-icon-video-play" circle>
          </el-button>
          <el-button v-if="scope.row.state" @click="stop(scope.row.id);" type="danger" size="small" title="Stop" icon="el-icon-switch-button" circle>
          </el-button>
          <el-button @click="openEdit(scope.row);" type="primary" size="small" title="Edit" icon="el-icon-edit" circle>
          </el-button>
          <el-button @click="info(scope.row);" type="info" size="small" title="Show command" icon="el-icon-info" circle>
          </el-button>
          <el-button @click="deleteConfirm(scope.row.id)" title="delete" type="danger" size="small" icon="el-icon-delete" circle>
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-dialog ref="editDialog" :title="panel.title" :visible.sync="panel.visible" width="90%" top="3vh" size="small">
      <el-form ref="infoForm" :model="panel.edit" label-width="120px">
        <el-form-item size="mini" label="name">
          <el-input v-model="panel.edit.name"></el-input>
        </el-form-item>
        <el-form-item size="mini" label="localHost">
          <el-input v-model="panel.edit.localHost"></el-input>
        </el-form-item>
        <el-form-item size="mini" label="localPort">
          <el-input v-model="panel.edit.localPort"></el-input>
        </el-form-item>
        <el-form-item size="mini" label="remoteHost">
          <el-input v-model="panel.edit.remoteHost"></el-input>
        </el-form-item>
        <el-form-item size="mini" label="remotePort">
          <el-input v-model="panel.edit.remotePort"></el-input>
        </el-form-item>
      </el-form>
      <span slot="footer" class="dialog-footer">
        <el-button @click="panel.visible = false">Cancel</el-button>
        <el-button type="primary" :loading="panel.loading" @click="confirmUpdate">
          {{panel.edit.id!=null?"Update":"Create"}}
        </el-button>
      </span>
    </el-dialog>
  </div>
</template>

<script>
const vscode =
  typeof acquireVsCodeApi != "undefined" ? acquireVsCodeApi() : null;
const postMessage = message => {
  if (vscode) {
    vscode.postMessage(message);
  }
};
export default {
  name: "App",
  data() {
    return {
      title: "",
      config: {},
      forwardList: [],
      error: false,
      errorMessage: "",
      panel: {
        title: "create foward",
        visible: false,
        loading: false,
        edit: {}
      }
    };
  },
  mounted() {
    window.addEventListener("message", ({ data }) => {
      console.log(data);
      if (!data) return;
      switch (data.type) {
        case "forwardList":
          this.forwardList = data.content;
          this.panel.loading = false;
          this.panel.visible = false;
          break;
        case "config":
          this.title = data.content.host;
          this.config = data.content;
          break;
        case "success":
          this.error = false;
          postMessage({ type: "load" });
          break;
        case "error":
          this.error = true;
          this.errorMessage = data.content;
          break;
      }
    });
    postMessage({ type: "init" });
  },
  methods: {
    createRequest() {
      this.panel.edit = {
        localHost: "127.0.0.1",
        remoteHost: "127.0.0.1"
      };
      this.panel.visible = true;
    },
    load() {
      postMessage({ type: "load" });
    },
    confirmUpdate() {
      postMessage({ type: "update", content: this.panel.edit });
      this.panel.loading = true;
    },
    info(row) {
      postMessage({
        type: "cmd",
        content: `ssh  -qTnN -L ${row.localHost}:${row.localPort}:${row.remoteHost}:${row.remotePort} ${this.config.username}@${this.config.host}`
      });
    },
    start(id) {
      postMessage({ type: "start", content: id });
    },
    stop(id) {
      postMessage({ type: "stop", content: id });
    },
    remove(id) {
      postMessage({ type: "remove", content: id });
    },
    openEdit(row) {
      this.panel.edit = row;
      this.panel.visible = true;
    },
    deleteConfirm(id) {
      this.$confirm(
        "Are you sure you want to delete this forward?",
        "Warning",
        {
          confirmButtonText: "OK",
          cancelButtonText: "Cancel",
          type: "warning"
        }
      )
        .then(() => {
          this.remove(id);
        })
        .catch(() => {
          console.log("error005", error);
          this.$message({ type: "info", message: "Delete canceled" });
        });
    },
    tryConnect() {
      postMessage({
        type: "CONNECT_TO_SQL_SERVER",
        databaseType: this.databaseType,
        connectionOption: this.connectionOption
      });
    }
  }
};
</script>

<style>
body{
  padding: 0;
}
</style>