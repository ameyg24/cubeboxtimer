import { describeRepositoryContract } from "./repositoryContract";
import { createMemoryRepository } from "../repository";

describeRepositoryContract("memory", () => createMemoryRepository());
