import { randomUUID } from 'crypto';
import FeatureStrategiesStore, {
    IFeatureStrategy,
} from '../../lib/db/feature-strategy-store';
import noLoggerProvider from './no-logger';
import {
    FeatureToggleWithEnvironment,
    IFeatureEnvironment,
    IFeatureOverview,
    IFeatureToggleClient,
    IFeatureToggleQuery,
} from '../../lib/types/model';
import feature from '../../lib/routes/admin-api/feature';
import NotFoundError from '../../lib/error/notfound-error';

interface ProjectEnvironment {
    projectName: string;
    environment: string;
}

export default class FakeFeatureStrategiesStore extends FeatureStrategiesStore {
    environmentAndFeature: Map<string, any[]> = new Map();

    projectToEnvironment: ProjectEnvironment[] = [];

    featureStrategies: IFeatureStrategy[] = [];

    constructor() {
        super(undefined, undefined, noLoggerProvider);
    }

    async createStrategyConfig(
        strategyConfig: Omit<IFeatureStrategy, 'id' | 'createdAt'>,
    ): Promise<IFeatureStrategy> {
        const newStrat = { ...strategyConfig, id: randomUUID() };
        this.featureStrategies.push(newStrat);
        return Promise.resolve(newStrat);
    }

    async getStrategiesForToggle(
        featureName: string,
    ): Promise<IFeatureStrategy[]> {
        return this.featureStrategies.filter(
            fS => fS.featureName === featureName,
        );
    }

    async getAllFeatureStrategies(): Promise<IFeatureStrategy[]> {
        return this.featureStrategies;
    }

    async deleteFeatureStrategies(): Promise<void> {
        this.featureStrategies = [];
        return Promise.resolve();
    }

    async getStrategiesForEnvironment(
        environment: string,
    ): Promise<IFeatureStrategy[]> {
        const stratEnvs = this.featureStrategies.filter(
            fS => fS.environment === environment,
        );
        return Promise.resolve(stratEnvs);
    }

    async removeAllStrategiesForEnv(
        feature_name: string,
        environment: string,
    ): Promise<void> {
        const toRemove = this.featureStrategies.filter(
            fS =>
                fS.featureName === feature_name &&
                fS.environment === environment,
        );
        this.featureStrategies = this.featureStrategies.filter(
            f =>
                !toRemove.some(
                    r =>
                        r.featureName === f.featureName &&
                        r.environment === f.environment,
                ),
        );
        return Promise.resolve();
    }

    async getAll(): Promise<IFeatureStrategy[]> {
        return Promise.resolve(this.featureStrategies);
    }

    async getStrategiesForFeature(
        project_name: string,
        feature_name: string,
        environment: string,
    ): Promise<IFeatureStrategy[]> {
        const rows = this.featureStrategies.filter(
            fS =>
                fS.projectName === project_name &&
                fS.featureName === feature_name &&
                fS.environment === environment,
        );
        return Promise.resolve(rows);
    }

    async getStrategiesForEnv(
        environment: string,
    ): Promise<IFeatureStrategy[]> {
        return this.featureStrategies.filter(
            fS => fS.environment === environment,
        );
    }

    async getFeatureToggleAdmin(
        featureName: string,
        archived: boolean = false,
    ): Promise<FeatureToggleWithEnvironment> {
        return Promise.reject('Not implemented');
    }

    async getFeatures(
        featureQuery?: IFeatureToggleQuery,
        archived: boolean = false,
    ): Promise<IFeatureToggleClient[]> {
        return Promise.resolve([]);
    }

    async getProjectOverview(projectId: string): Promise<IFeatureOverview[]> {
        return Promise.resolve([]);
    }

    async getStrategyById(id: string): Promise<IFeatureStrategy> {
        const strat = this.featureStrategies.find(fS => fS.id === id);
        if (strat) {
            return Promise.resolve(strat);
        }
        return Promise.reject(
            new NotFoundError(`Could not find strategy with id ${id}`),
        );
    }

    async connectEnvironmentAndFeature(
        feature_name: string,
        environment: string,
        enabled: boolean = false,
    ): Promise<void> {
        if (!this.environmentAndFeature.has(environment)) {
            this.environmentAndFeature.set(environment, []);
        }
        this.environmentAndFeature
            .get(environment)
            .push({ feature: feature_name, enabled });
        return Promise.resolve();
    }

    async enableEnvironmentForFeature(
        feature_name: string,
        environment: string,
    ): Promise<void> {
        if (!this.environmentAndFeature.has(environment)) {
            this.environmentAndFeature.set(environment, [
                {
                    featureName: feature,
                    enabled: true,
                },
            ]);
        }
        const features = this.environmentAndFeature.get(environment).map(f => {
            if (f.featureName === feature_name) {
                // eslint-disable-next-line no-param-reassign
                f.enabled = true;
            }
            return f;
        });
        this.environmentAndFeature.set(environment, features);
        return Promise.resolve();
    }

    async removeEnvironmentForFeature(
        feature_name: string,
        environment: string,
    ): Promise<void> {
        this.environmentAndFeature.set(
            environment,
            this.environmentAndFeature
                .get(environment)
                .filter(e => e.featureName !== feature_name),
        );
        return Promise.resolve();
    }

    async disconnectEnvironmentFromProject(
        environment: string,
        project: string,
    ): Promise<void> {
        this.projectToEnvironment = this.projectToEnvironment.filter(
            f => f.projectName !== project && f.environment !== environment,
        );
        return Promise.resolve();
    }

    async updateStrategy(
        id: string,
        updates: Partial<IFeatureStrategy>,
    ): Promise<IFeatureStrategy> {
        this.featureStrategies = this.featureStrategies.map(f => {
            if (f.id === id) {
                return { ...f, ...updates };
            }
            return f;
        });
        return Promise.resolve(this.featureStrategies.find(f => f.id === id));
    }

    async getMembers(projectId: string): Promise<number> {
        return Promise.resolve(0);
    }

    async getStrategiesAndMetadataForEnvironment(
        environment: string,
        featureName: string,
    ): Promise<void> {
        return Promise.resolve();
    }

    async deleteConfigurationsForProjectAndEnvironment(
        projectId: String,
        environment: String,
    ): Promise<void> {
        return Promise.resolve();
    }

    async isEnvironmentEnabled(
        featureName: string,
        environment: string,
    ): Promise<boolean> {
        const enabled =
            this.environmentAndFeature
                .get(environment)
                ?.find(f => f.featureName === featureName)?.enabled || false;
        return Promise.resolve(enabled);
    }

    async toggleEnvironmentEnabledStatus(
        environment: string,
        featureName: string,
        enabled: boolean,
    ): Promise<boolean> {
        return Promise.resolve(enabled);
    }

    async getAllFeatureEnvironments(): Promise<IFeatureEnvironment[]> {
        return Promise.resolve([]);
    }
}

module.exports = FakeFeatureStrategiesStore;
