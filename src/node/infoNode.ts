import { setupMaster } from "cluster";
import { TreeItemCollapsibleState } from "vscode";
import { NodeType } from "../common/constant";
import AbstractNode from "./abstracNode";

export class InfoNode extends AbstractNode {

    contextValue = NodeType.INFO;

    constructor(info: string) {
        super(info)
        this.collapsibleState = TreeItemCollapsibleState.None
    }


    getChildren(): Promise<AbstractNode[]> {
        return null;
    }

}