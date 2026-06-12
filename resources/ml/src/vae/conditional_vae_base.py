"""
conditional_vae_base.py
========================
Conditional версия BaseVariationalAutoencoder.
Полностью сохраняет все методы оригинального vae_base.py.
Не трогает оригинальный файл.
"""

import os
import warnings
import numpy as np
import tensorflow as tf
import joblib

from abc import ABC, abstractmethod
from tensorflow.keras.models import Model
from tensorflow.keras.layers import Layer
from tensorflow.keras.metrics import Mean
from tensorflow.keras.backend import random_normal
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
warnings.filterwarnings("ignore")


class Sampling(Layer):
    def call(self, inputs):
        z_mean, z_log_var = inputs
        batch = tf.shape(z_mean)[0]
        dim = tf.shape(z_mean)[1]
        epsilon = random_normal(shape=(batch, dim))
        return z_mean + tf.exp(0.5 * z_log_var) * epsilon


class ConditionalBaseVariationalAutoencoder(Model, ABC):
    model_name = None
    is_conditional = True

    def __init__(
        self,
        seq_len,
        feat_dim,
        latent_dim,
        reconstruction_wt=3.0,
        batch_size=16,
        std_loss_weight=0.07,
        hidden_layer_sizes=None,      # для совместимости с TimeVAE
        trend_poly=0,                 # для совместимости
        custom_seas=None,             # для совместимости
        use_residual_conn=True,       # для совместимости
        conditional=True,               # ← Добавлено!
        **kwargs,
    ):
        super().__init__(**kwargs)

        self.seq_len = seq_len
        self.feat_dim = feat_dim
        self.latent_dim = latent_dim
        self.reconstruction_wt = reconstruction_wt
        self.batch_size = batch_size
        self.std_loss_weight = std_loss_weight

        # Параметры оригинального TimeVAE
        self.hidden_layer_sizes = hidden_layer_sizes or [50, 100, 200]
        self.trend_poly = trend_poly
        self.custom_seas = custom_seas
        self.use_residual_conn = use_residual_conn
        self.conditional = conditional
        # Метрики
        self.total_loss_tracker = Mean(name="loss")
        self.reconstruction_loss_tracker = Mean(name="reconstruction_loss")
        self.kl_loss_tracker = Mean(name="kl_loss")
        self.std_loss_tracker = Mean(name="std_loss")

        # Метрики для валидации (новое!)
        self.val_total_loss_tracker = Mean(name="val_loss")
        self.val_reconstruction_loss_tracker = Mean(name="val_reconstruction_loss")
        self.val_kl_loss_tracker = Mean(name="val_kl_loss")
        self.val_std_loss_tracker = Mean(name="val_std_loss")
        self.encoder = None
        self.decoder = None

    # ====================== fit_on_data (точно как в оригинале) ======================
    def fit_on_data(self, train_data, valid_data=None, max_epochs=1000, verbose=0):
        loss_to_monitor = "loss"
        early_stopping = EarlyStopping(
            monitor=loss_to_monitor, min_delta=1e-2, patience=20,
            mode="min", restore_best_weights=True
        )
        reduce_lr = ReduceLROnPlateau(
            monitor=loss_to_monitor, factor=0.5, patience=5, mode="min"
        )

        print(f"🚀 Запуск обучения на {max_epochs} эпох...")

        if valid_data is not None:
            print("📊 Валидация включена (оценка на valid set каждую эпоху)")
            self.fit(
                train_data,
                validation_data=valid_data,
                epochs=max_epochs,
                batch_size=self.batch_size,
                callbacks=[early_stopping, reduce_lr],
                verbose=verbose
            )
        else:
            self.fit(
            train_data,
            epochs=max_epochs,
            batch_size=self.batch_size,
            callbacks=[early_stopping, reduce_lr],
            verbose=verbose
         )

    def _get_std_loss(self, X, X_recons):
        std_real = tf.math.reduce_std(X, axis=1)
        std_recon = tf.math.reduce_std(X_recons, axis=1)
        err = tf.math.squared_difference(std_real, std_recon)
        
        return tf.reduce_sum(err)

    def _get_reconstruction_loss(self, X, X_recons):
        def get_reconst_loss_by_axis(X, X_c, axis):
            x_r = tf.reduce_mean(X, axis=axis)
            x_c_r = tf.reduce_mean(X_c, axis=axis)
            err = tf.math.squared_difference(x_r, x_c_r)
            loss = tf.reduce_sum(err)
            return loss

        err = tf.math.squared_difference(X, X_recons)
        reconst_loss = tf.reduce_sum(err)
        reconst_loss += get_reconst_loss_by_axis(X, X_recons, axis=[2])
        return reconst_loss

    # ====================== Conditional train_step / test_step ======================
    def train_step(self, data):
        # data может быть dict или tuple
        if isinstance(data, dict):
            previous_day = data["previous"]
            next_day = data["next"]
        elif isinstance(data, tuple):
            previous_day, next_day = data
        else:
            raise ValueError(f"Unexpected data format: {type(data)}")

        with tf.GradientTape() as tape:
            z_mean, z_log_var, z = self.encoder(previous_day)
            reconstruction = self.decoder([z, previous_day])

            reconstruction_loss = self._get_reconstruction_loss(next_day, reconstruction)
            std_loss = self._get_std_loss(next_day, reconstruction)

            kl_loss = -0.5 * (1 + z_log_var - tf.square(z_mean) - tf.exp(z_log_var))
            kl_loss = tf.reduce_sum(tf.reduce_sum(kl_loss, axis=1))

            total_loss = (self.reconstruction_wt * reconstruction_loss + kl_loss + self.std_loss_weight * std_loss)

        grads = tape.gradient(total_loss, self.trainable_weights)
        self.optimizer.apply_gradients(zip(grads, self.trainable_weights))

        self.total_loss_tracker.update_state(total_loss)
        self.reconstruction_loss_tracker.update_state(reconstruction_loss)
        self.kl_loss_tracker.update_state(kl_loss)
        self.std_loss_tracker.update_state(std_loss)

        return {
            "loss": self.total_loss_tracker.result(),
            "reconstruction_loss": self.reconstruction_loss_tracker.result(),
            "kl_loss": self.kl_loss_tracker.result(),
            "std_loss": self.std_loss_tracker.result(),
        }

    def test_step(self, data):
        if isinstance(data, tuple):
            previous_day, next_day = data
        else:
            previous_day = data["previous"]
            next_day = data["next"]

        z_mean, z_log_var, z = self.encoder(previous_day)
        reconstruction = self.decoder([z, previous_day])

        reconstruction_loss = self._get_reconstruction_loss(next_day, reconstruction)
        std_loss = self._get_std_loss(next_day, reconstruction)

        kl_loss = -0.5 * (1 + z_log_var - tf.square(z_mean) - tf.exp(z_log_var))
        kl_loss = tf.reduce_sum(tf.reduce_sum(kl_loss, axis=1))

        total_loss = (self.reconstruction_wt * reconstruction_loss + kl_loss + self.std_loss_weight * std_loss)

        # Обновляем валидационные трекеры
        self.val_total_loss_tracker.update_state(total_loss)
        self.val_reconstruction_loss_tracker.update_state(reconstruction_loss)
        self.val_kl_loss_tracker.update_state(kl_loss)
        self.val_std_loss_tracker.update_state(std_loss)

        return {
            "loss": self.val_total_loss_tracker.result(),
            "reconstruction_loss": self.val_reconstruction_loss_tracker.result(),
            "kl_loss": self.val_kl_loss_tracker.result(),
            "std_loss": self.val_std_loss_tracker.result(),
        }

    def call(self, inputs, training=False):
        if isinstance(inputs, (list, tuple)) and len(inputs) == 2:
            z, condition = inputs
            return self.decoder([z, condition])
        else:
            condition = tf.convert_to_tensor(inputs, dtype=tf.float32)  # ← защита
            _, _, z = self.encoder(condition)
            return self.decoder([z, condition])

    # ====================== Save / Load ======================
    def save_weights(self, filepath: str):
        """Нативное сохранение весов Keras (точно как в оригинальной timeVAE)"""
        os.makedirs(os.path.dirname(filepath) or ".", exist_ok=True)
        
        # Сохраняем encoder и decoder отдельно — надёжно и быстро
        encoder_path = f"{filepath}_encoder.weights.h5"
        decoder_path = f"{filepath}_decoder.weights.h5"
        
        self.encoder.save_weights(encoder_path)
        self.decoder.save_weights(decoder_path)
        
        print(f"Weights saved (native Keras): {filepath}")

    def load_weights(self, filepath: str):
        """Нативная загрузка"""
        encoder_path = f"{filepath}_encoder.weights.h5"
        decoder_path = f"{filepath}_decoder.weights.h5"
        
        self.encoder.load_weights(encoder_path)
        self.decoder.load_weights(decoder_path)
        
        print(f"Weights loaded (native Keras) from {filepath}")

    def save(self, model_dir: str):
        """Основной метод сохранения conditional модели"""
        os.makedirs(model_dir, exist_ok=True)
        self.save_weights(model_dir)   # ← правильно передаём только папку

        dict_params = {
            "seq_len": self.seq_len,
            "feat_dim": self.feat_dim,
            "latent_dim": self.latent_dim,
            "reconstruction_wt": self.reconstruction_wt,
            "std_loss_weight": self.std_loss_weight,
            "hidden_layer_sizes": list(self.hidden_layer_sizes),
            "trend_poly": self.trend_poly,
            "custom_seas": self.custom_seas,
            "use_residual_conn": self.use_residual_conn,
            "conditional": True,
        }
        params_file = os.path.join(model_dir, f"{self.model_name}_parameters.pkl")
        joblib.dump(dict_params, params_file)
        
        print(f"Conditional model fully saved to {model_dir}")


    
    @abstractmethod
    def _get_encoder(self, **kwargs):
        raise NotImplementedError

    @abstractmethod
    def _get_decoder(self, **kwargs):
        raise NotImplementedError

    def summary(self):
        self.encoder.summary()
        self.decoder.summary()

    def get_num_trainable_variables(self):
        trainableParams = int(np.sum([np.prod(v.get_shape()) for v in self.trainable_weights]))
        nonTrainableParams = int(np.sum([np.prod(v.get_shape()) for v in self.non_trainable_weights]))
        return trainableParams, nonTrainableParams, trainableParams + nonTrainableParams

    def get_prior_samples(self, num_samples):
        Z = np.random.randn(num_samples, self.latent_dim)
        samples = self.decoder.predict(Z, verbose=0)
        return samples

    def get_prior_samples_given_Z(self, Z):
        samples = self.decoder.predict(Z)
        return samples