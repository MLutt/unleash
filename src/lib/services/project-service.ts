import User from '../types/user';
import { AccessService, IUserWithRole, RoleName } from './access-service';
import ProjectStore, { IProject } from '../db/project-store';
import EventStore from '../db/event-store';
import NameExistsError from '../error/name-exists-error';
import InvalidOperationError from '../error/invalid-operation-error';
import { nameType } from '../routes/admin-api/util';
import schema from './project-schema';
import NotFoundError from '../error/notfound-error';
import FeatureToggleStore from '../db/feature-toggle-store';
import { IRole } from '../db/access-store';
import {
    PROJECT_CREATED,
    PROJECT_DELETED,
    PROJECT_UPDATED,
} from '../types/events';
import { IUnleashStores } from '../types/stores';
import { IUnleashConfig } from '../types/option';
import { features } from 'process';
import FeatureTypeStore from '../db/feature-type-store';

const getCreatedBy = (user: User) => user.email || user.username;

const DEFAULT_PROJECT = 'default';

export interface UsersWithRoles {
    users: IUserWithRole[];
    roles: IRole[];
}

export default class ProjectService {
    private projectStore: ProjectStore;

    private accessService: AccessService;

    private eventStore: EventStore;

    private featureToggleStore: FeatureToggleStore;

    private featureTypeStore: FeatureTypeStore;

    private logger: any;

    constructor(
        {
            projectStore,
            eventStore,
            featureToggleStore,
            featureTypeStore,
        }: Pick<
            IUnleashStores,
            | 'projectStore'
            | 'eventStore'
            | 'featureToggleStore'
            | 'featureTypeStore'
        >,
        config: IUnleashConfig,
        accessService: AccessService,
    ) {
        this.projectStore = projectStore;
        this.accessService = accessService;
        this.eventStore = eventStore;
        this.featureToggleStore = featureToggleStore;
        this.featureTypeStore = featureTypeStore;
        this.logger = config.getLogger('services/project-service.js');
    }

    async setHealthRating() {
        const projects = await this.getProjects();

        projects.forEach(project => {
            this.calculateHealthRating(project);
        });
    }

    private async getPotentiallyStaleToggles(activeToggles) {
        const featureTypes = await this.featureTypeStore.getAll();

        const featureTypeMap = featureTypes.reduce((acc, current) => {
            acc[current.id] = current.lifetimeDays;

            return acc;
        }, {});

        const result = activeToggles.filter(
            feature => isFeatureExpired(feature) && !feature.stale,
        );

        return result;
    }

    async calculateHealthRating(project: IProject) {
        const toggles = await this.featureToggleStore.getFeaturesBy({
            project: project.id,
        });

        const activeToggles = toggles.filter(feature => !feature.stale);
        const staleToggles = toggles.length - activeToggles.length;
        const potentiallyStaleToggles = this.getPotentiallyStaleToggles(
            activeToggles,
        );

        const getHealthRating = (
            total,
            staleTogglesCount,
            potentiallyStaleTogglesCount,
        ) => {
            const startPercentage = 100;

            const stalePercentage = (staleTogglesCount / total) * 100;

            const potentiallyStalePercentage =
                (potentiallyStaleTogglesCount / total) * 100;

            return Math.round(
                startPercentage - stalePercentage - potentiallyStalePercentage,
            );
        };

        const total = features.length;
        const activeTogglesArray = getActiveToggles();
        const potentiallyStaleToggles = getPotentiallyStaleToggles(
            activeTogglesArray,
        );

        const activeTogglesCount = activeTogglesArray.length;
        const staleTogglesCount = features.length - activeTogglesCount;
        const potentiallyStaleTogglesCount = potentiallyStaleToggles.length;

        const healthRating = getHealthRating(
            total,
            staleTogglesCount,
            potentiallyStaleTogglesCount,
        );
    }

    async getProjects(): Promise<IProject[]> {
        return this.projectStore.getAll();
    }

    async getProject(id: string): Promise<IProject> {
        return this.projectStore.get(id);
    }

    async createProject(newProject: IProject, user: User): Promise<IProject> {
        const data = await schema.validateAsync(newProject);
        await this.validateUniqueId(data.id);

        await this.projectStore.create(data);

        await this.accessService.createDefaultProjectRoles(user, data.id);

        await this.eventStore.store({
            type: PROJECT_CREATED,
            createdBy: getCreatedBy(user),
            data,
        });

        return data;
    }

    async updateProject(updatedProject: IProject, user: User): Promise<void> {
        await this.projectStore.get(updatedProject.id);
        const project = await schema.validateAsync(updatedProject);

        await this.projectStore.update(project);

        await this.eventStore.store({
            type: PROJECT_UPDATED,
            createdBy: getCreatedBy(user),
            data: project,
        });
    }

    async deleteProject(id: string, user: User): Promise<void> {
        if (id === DEFAULT_PROJECT) {
            throw new InvalidOperationError(
                'You can not delete the default project!',
            );
        }

        const toggles = await this.featureToggleStore.getFeaturesBy({
            project: id,
            archived: false,
        });

        if (toggles.length > 0) {
            throw new InvalidOperationError(
                'You can not delete as project with active feature toggles',
            );
        }

        await this.projectStore.delete(id);

        await this.eventStore.store({
            type: PROJECT_DELETED,
            createdBy: getCreatedBy(user),
            data: { id },
        });

        this.accessService.removeDefaultProjectRoles(user, id);
    }

    async validateId(id: string): Promise<boolean> {
        await nameType.validateAsync(id);
        await this.validateUniqueId(id);
        return true;
    }

    async validateUniqueId(id: string): Promise<void> {
        try {
            await this.projectStore.hasProject(id);
        } catch (error) {
            // No conflict, everything ok!
            return;
        }

        // Intentional throw here!
        throw new NameExistsError('A project with this id already exists.');
    }

    // RBAC methods
    async getUsersWithAccess(projectId: string): Promise<UsersWithRoles> {
        const [roles, users] = await this.accessService.getProjectRoleUsers(
            projectId,
        );

        return {
            roles,
            users,
        };
    }

    async addUser(
        projectId: string,
        roleId: number,
        userId: number,
    ): Promise<void> {
        const [roles, users] = await this.accessService.getProjectRoleUsers(
            projectId,
        );

        const role = roles.find(r => r.id === roleId);
        if (!role) {
            throw new NotFoundError(
                `Could not find roleId=${roleId} on project=${projectId}`,
            );
        }

        const alreadyHasAccess = users.some(u => u.id === userId);
        if (alreadyHasAccess) {
            throw new Error(`User already have access to project=${projectId}`);
        }

        await this.accessService.addUserToRole(userId, role.id);
    }

    async removeUser(
        projectId: string,
        roleId: number,
        userId: number,
    ): Promise<void> {
        const roles = await this.accessService.getRolesForProject(projectId);
        const role = roles.find(r => r.id === roleId);
        if (!role) {
            throw new NotFoundError(
                `Couldn't find roleId=${roleId} on project=${projectId}`,
            );
        }

        if (role.name === RoleName.OWNER) {
            const users = await this.accessService.getUsersForRole(role.id);
            if (users.length < 2) {
                throw new Error('A project must have at least one owner');
            }
        }

        await this.accessService.removeUserFromRole(userId, role.id);
    }
}

module.exports = ProjectService;
